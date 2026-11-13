(() => {
    const esc = value => String(value ?? '').replace(/[&<>"']/g,char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    const reasons = { daily:'Quotidienne',manual:'Manuelle',before_reset:'Avant réinitialisation',before_restore:'Avant restauration' };
    window.renderTenantBackups = async (container,{ request,basePath,organizationId,superadmin = false }) => {
        container.classList.add('tenant-backups');
        let offset = 0;
        async function load() {
            try {
                const data = await request(`${basePath}?offset=${offset}`);
                container.innerHTML = `<h3>Sauvegardes automatiques et restauration</h3><p>Une sauvegarde de chaque client est créée toutes les 24 h lorsque le serveur fonctionne, conservée ${esc(data.retention_days)} jours en base et disponible après redéploiement. La fusion ajoute uniquement les données manquantes : les données actuelles ne sont pas écrasées ; un conflit annule toute la fusion.</p>${superadmin ? '<p>Le superadmin peut également restaurer les utilisateurs, abonnements et données comptables.</p>' : '<p>La restauration des utilisateurs, paramètres, abonnements et données comptables est réservée au superadmin.</p>'}<p>Dernière sauvegarde quotidienne : ${esc(data.status?.last_success_at ? new Date(data.status.last_success_at).toLocaleString('fr-FR') : 'Pas encore effectuée')}</p>${data.status?.last_error ? `<p class="error sp-error" role="alert">Échec de sauvegarde : ${esc(data.status.last_error)}</p>` : ''}<button type="button" class="btn sp-btn" data-create-backup>Créer une sauvegarde maintenant</button><fieldset><legend>Modules à fusionner</legend>${data.modules.filter(module => superadmin || !module.protected).map(module => `<label class="sp-checkbox"><input type="checkbox" name="restore_modules" value="${esc(module.key)}" checked>${esc(module.label)}</label>`).join('')}</fieldset><label>Confirmation : RESTAURER ${esc(organizationId)}<input name="restore_confirmation" autocomplete="off"></label><div class="table-scroll sp-table-wrap"><table><thead><tr><th>Date</th><th>Origine</th><th>Lignes</th><th>Taille</th><th>Action</th></tr></thead><tbody>${data.items.map(item => `<tr><td>${esc(new Date(item.created_at).toLocaleString('fr-FR'))}</td><td>${esc(reasons[item.reason] || item.reason)}</td><td>${esc(item.row_count)}</td><td>${esc((Number(item.uncompressed_size)/1048576).toFixed(2))} Mo</td><td><button type="button" class="btn sp-btn" data-restore-backup="${esc(item.id)}">Fusionner</button></td></tr>`).join('') || '<tr><td colspan="5">Aucune sauvegarde.</td></tr>'}</tbody></table></div><div><button type="button" class="btn sp-btn" data-previous ${offset === 0 ? 'disabled' : ''}>Précédent</button><span>${esc(offset + (data.items.length ? 1 : 0))}–${esc(offset + data.items.length)} / ${esc(data.total)}</span><button type="button" class="btn sp-btn" data-next ${offset + data.limit >= data.total ? 'disabled' : ''}>Suivant</button></div><p class="error sp-error" role="alert" data-backup-result></p>`;
                const result = container.querySelector('[data-backup-result]');
                const run = async (button,action) => {
                    button.disabled = true; result.textContent = '';
                    try { await action(); }
                    catch (error) { result.textContent = error.message; }
                    finally { if (button.isConnected) button.disabled = false; }
                };
                container.querySelector('[data-create-backup]').onclick = event => run(event.currentTarget,async () => {
                    await request(basePath,{ method:'POST',body:JSON.stringify({}) }); await load();
                });
                container.querySelectorAll('[data-restore-backup]').forEach(button => button.onclick = () => run(button,async () => {
                    const modules = [...container.querySelectorAll('input[name="restore_modules"]:checked')].map(input => input.value);
                    const confirmation = container.querySelector('[name="restore_confirmation"]').value;
                    if (!modules.length) throw Error('Choisissez au moins un module à restaurer.');
                    if (confirmation !== `RESTAURER ${organizationId}`) throw Error('Saisissez la confirmation exacte.');
                    if (!window.confirm('Fusionner cette sauvegarde ? Les données actuelles sont conservées et une sauvegarde de sécurité sera créée.')) return;
                    const restored = await request(`${basePath}/${button.dataset.restoreBackup}/restore`,{ method:'POST',body:JSON.stringify({ modules,confirmation }) });
                    await load();
                    container.querySelector('[data-backup-result]').textContent = `${restored.message} ${restored.inserted} ajouté(s), ${restored.already_present} déjà présent(s).`;
                }));
                container.querySelector('[data-previous]').onclick = () => { offset = Math.max(0,offset - data.limit); load(); };
                container.querySelector('[data-next]').onclick = () => { offset += data.limit; load(); };
            } catch (error) { container.innerHTML = `<p class="error sp-error" role="alert">${esc(error.message)}</p>`; }
        }
        await load();
    };
})();

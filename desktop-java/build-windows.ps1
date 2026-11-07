$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$target = Join-Path $project 'target'
$image = Join-Path $target 'REDAMS-Desktop-Prototype'
$zip = Join-Path $target 'REDAMS-Desktop-Prototype-Windows.zip'
$inputDir = Join-Path $target ("packaging-input-" + [guid]::NewGuid().ToString('N'))

if (Test-Path -LiteralPath $image) { throw "Le dossier existe déjà : $image. Déplacez-le avant de relancer." }
if (Test-Path -LiteralPath $zip) { throw "L'archive existe déjà : $zip. Déplacez-la avant de relancer." }
foreach ($tool in @('mvn.cmd', 'jpackage.exe')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool introuvable. Installez Maven et un JDK 21." }
}

& mvn.cmd -B -f (Join-Path $project 'pom.xml') package
if ($LASTEXITCODE -ne 0) { throw 'La compilation ou les tests ont échoué.' }
New-Item -ItemType Directory -Path $inputDir | Out-Null
try {
    & mvn.cmd -B -f (Join-Path $project 'pom.xml') org.apache.maven.plugins:maven-dependency-plugin:3.8.1:copy-dependencies "-DincludeScope=runtime" "-DoutputDirectory=$inputDir"
    if ($LASTEXITCODE -ne 0) { throw 'La copie des dépendances a échoué.' }
    Copy-Item -LiteralPath (Join-Path $target 'desktop-local-core-0.1.0-SNAPSHOT.jar') -Destination $inputDir
    & jpackage.exe --type app-image --dest $target --name 'REDAMS-Desktop-Prototype' `
        --input $inputDir --main-jar 'desktop-local-core-0.1.0-SNAPSHOT.jar' `
        --main-class 'fr.redams.desktop.app.PrototypeDesktop' `
        --add-modules 'java.desktop,java.sql,java.net.http,jdk.httpserver,jdk.crypto.ec,java.naming,java.management,jdk.unsupported'
    if ($LASTEXITCODE -ne 0) { throw 'La création de l’application Windows a échoué.' }
    Compress-Archive -LiteralPath $image -DestinationPath $zip -CompressionLevel Optimal
    Write-Output "Application : $image"
    Write-Output "Archive : $zip"
} finally {
    if (Test-Path -LiteralPath $inputDir) { Remove-Item -LiteralPath $inputDir -Recurse -Force }
}

-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: localhost    Database: redams_stk
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `redams_stk`
--

--
-- Table structure for table `account_email_claims`
--

DROP TABLE IF EXISTS `account_email_claims`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `account_email_claims` (
  `email` varchar(190) NOT NULL,
  `user_id` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`email`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `account_email_claims_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `account_email_claims`
--

LOCK TABLES `account_email_claims` WRITE;
/*!40000 ALTER TABLE `account_email_claims` DISABLE KEYS */;
INSERT INTO `account_email_claims` VALUES ('admin@demo.redams-stk.local',1);
/*!40000 ALTER TABLE `account_email_claims` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `entity_type` varchar(80) NOT NULL,
  `entity_id` varchar(80) DEFAULT NULL,
  `details_json` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_tenant_date` (`organization_id`,`created_at`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `audit_logs_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (1,1,1,'SUPPLIER_CREATED','supplier','1',NULL,'2026-11-04 07:29:59'),(2,1,1,'PURCHASE_CREATED','purchase_order','1',NULL,'2026-11-04 07:30:56'),(3,1,1,'PURCHASE_ORDERED','purchase_order','1',NULL,'2026-11-04 07:31:14'),(4,1,1,'PATIENT_COVERAGES_VIEWED','insurance_coverage',NULL,NULL,'2026-11-04 15:33:04'),(5,1,1,'PATIENT_COVERAGES_VIEWED','insurance_coverage',NULL,NULL,'2026-11-04 15:33:10'),(6,1,1,'PATIENT_CREATED','patient','1',NULL,'2026-11-04 15:34:06'),(7,1,1,'PATIENT_HISTORY_VIEWED','patient','1',NULL,'2026-11-04 15:34:09'),(8,1,1,'PATIENT_COVERAGES_VIEWED','insurance_coverage',NULL,NULL,'2026-11-04 15:35:23'),(9,1,1,'PATIENT_COVERAGES_VIEWED','insurance_coverage',NULL,NULL,'2026-11-04 15:38:04'),(10,1,1,'PATIENT_COVERAGES_VIEWED','insurance_coverage',NULL,NULL,'2026-11-04 15:38:05'),(11,1,1,'CASH_SESSION_OPENED','cash_session','1','{\"openingCash\": 50000}','2026-11-04 16:09:17'),(12,1,1,'SALE_CREATED','sales_invoice','1','{\"reviewFlags\": [], \"totalAmount\": 12000, \"invoiceNumber\": \"FAC-20261104-000001\"}','2026-11-04 16:09:52'),(13,1,1,'PRODUCT_BARCODES_GENERATED','product','2','{\"productIds\": [2, 1, 3]}','2026-11-04 16:39:19'),(14,1,1,'SALE_CREATED','sales_invoice','2','{\"reviewFlags\": [], \"totalAmount\": 6050, \"invoiceNumber\": \"FAC-20261104-000002\"}','2026-11-04 17:00:04'),(15,1,1,'SUPPORT_CHAT_STARTED','support_ticket','1','{\"token\": \"4820780AF7F3C6CF020427852D1CB9D3\", \"assigned_agent_id\": null}','2026-11-04 22:55:44');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `backup_records`
--

DROP TABLE IF EXISTS `backup_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `backup_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `status` enum('queued','completed','failed') NOT NULL DEFAULT 'queued',
  `created_by` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `organization_id` (`organization_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `backup_records_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `backup_records_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `backup_records`
--

LOCK TABLES `backup_records` WRITE;
/*!40000 ALTER TABLE `backup_records` DISABLE KEYS */;
/*!40000 ALTER TABLE `backup_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `cash_movements`
--

DROP TABLE IF EXISTS `cash_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cash_movements` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `session_id` bigint unsigned NOT NULL,
  `movement_type` enum('sale','income','expense','refund') NOT NULL,
  `payment_method` enum('cash','mobile_money','bank_transfer','insurance','other') NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `cash_received` decimal(14,2) NOT NULL DEFAULT '0.00',
  `cash_change` decimal(14,2) NOT NULL DEFAULT '0.00',
  `description` varchar(255) NOT NULL,
  `invoice_id` bigint unsigned DEFAULT NULL,
  `recorded_by` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cash_movements_session` (`session_id`,`created_at`),
  KEY `idx_cash_movements_tenant_date` (`organization_id`,`created_at`),
  KEY `invoice_id` (`invoice_id`),
  KEY `recorded_by` (`recorded_by`),
  CONSTRAINT `cash_movements_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `cash_movements_ibfk_2` FOREIGN KEY (`session_id`) REFERENCES `cash_sessions` (`id`),
  CONSTRAINT `cash_movements_ibfk_3` FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices` (`id`),
  CONSTRAINT `cash_movements_ibfk_4` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cash_movements`
--

LOCK TABLES `cash_movements` WRITE;
/*!40000 ALTER TABLE `cash_movements` DISABLE KEYS */;
INSERT INTO `cash_movements` VALUES (1,1,1,'sale','cash',12000.00,12000.00,0.00,'Paiement facture 1',1,1,'2026-11-04 16:09:52'),(2,1,1,'sale','cash',6050.00,6100.00,50.00,'Paiement facture 2',2,1,'2026-11-04 17:00:04');
/*!40000 ALTER TABLE `cash_movements` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `cash_sessions`
--

DROP TABLE IF EXISTS `cash_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cash_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `opened_by` bigint unsigned NOT NULL,
  `closed_by` bigint unsigned DEFAULT NULL,
  `opening_cash` decimal(14,2) NOT NULL,
  `expected_cash` decimal(14,2) DEFAULT NULL,
  `closing_cash` decimal(14,2) DEFAULT NULL,
  `variance` decimal(14,2) DEFAULT NULL,
  `status` enum('open','closed') NOT NULL DEFAULT 'open',
  `opened_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cash_sessions_tenant_status` (`organization_id`,`status`,`opened_at`),
  KEY `opened_by` (`opened_by`),
  KEY `closed_by` (`closed_by`),
  CONSTRAINT `cash_sessions_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `cash_sessions_ibfk_2` FOREIGN KEY (`opened_by`) REFERENCES `users` (`id`),
  CONSTRAINT `cash_sessions_ibfk_3` FOREIGN KEY (`closed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cash_sessions`
--

LOCK TABLES `cash_sessions` WRITE;
/*!40000 ALTER TABLE `cash_sessions` DISABLE KEYS */;
INSERT INTO `cash_sessions` VALUES (1,1,1,NULL,50000.00,NULL,NULL,NULL,'open','2026-11-04 16:09:17',NULL);
/*!40000 ALTER TABLE `cash_sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `insurers`
--

DROP TABLE IF EXISTS `insurers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `insurers` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `name` varchar(190) NOT NULL,
  `contact_name` varchar(180) DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `address` text,
  `notes` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_insurers_tenant_name` (`organization_id`,`name`),
  CONSTRAINT `insurers_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `insurers`
--

LOCK TABLES `insurers` WRITE;
/*!40000 ALTER TABLE `insurers` DISABLE KEYS */;
/*!40000 ALTER TABLE `insurers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_reads`
--

DROP TABLE IF EXISTS `notification_reads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_reads` (
  `notification_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `read_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`notification_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `notification_reads_ibfk_1` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `notification_reads_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_reads`
--

LOCK TABLES `notification_reads` WRITE;
/*!40000 ALTER TABLE `notification_reads` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_reads` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `title` varchar(180) NOT NULL,
  `message` text NOT NULL,
  `audience` enum('organization','user') NOT NULL,
  `recipient_user_id` bigint unsigned DEFAULT NULL,
  `created_by` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_tenant_date` (`organization_id`,`created_at`),
  KEY `idx_notifications_recipient` (`recipient_user_id`,`created_at`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `notifications_ibfk_2` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `notifications_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `notifications_chk_1` CHECK ((((`audience` = _utf8mb4'organization') and (`recipient_user_id` is null)) or ((`audience` = _utf8mb4'user') and (`recipient_user_id` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `organization_settings`
--

DROP TABLE IF EXISTS `organization_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `organization_settings` (
  `organization_id` bigint unsigned NOT NULL,
  `display_name` varchar(180) DEFAULT NULL,
  `logo_url` varchar(500) DEFAULT NULL,
  `primary_color` char(7) NOT NULL DEFAULT '#145C4B',
  `secondary_color` char(7) NOT NULL DEFAULT '#D7A84B',
  `locale` varchar(8) NOT NULL DEFAULT 'fr',
  `currency` char(3) NOT NULL DEFAULT 'XAF',
  `timezone` varchar(80) NOT NULL DEFAULT 'Africa/Douala',
  `date_format` varchar(30) NOT NULL DEFAULT 'DD/MM/YYYY',
  `qr_format` varchar(30) NOT NULL DEFAULT 'QR',
  `barcode_format` varchar(30) NOT NULL DEFAULT 'CODE128',
  `sales_tax_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
  `default_label_format` varchar(20) NOT NULL DEFAULT 'barcode',
  PRIMARY KEY (`organization_id`),
  CONSTRAINT `organization_settings_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `organization_settings`
--

LOCK TABLES `organization_settings` WRITE;
/*!40000 ALTER TABLE `organization_settings` DISABLE KEYS */;
INSERT INTO `organization_settings` VALUES (1,'Centre de Santé Démo','/uploads/logos/organization-1-0ddc2271-1e1f-4d3f-9ece-e014a4e688a2.png','#102f29','#000000','en','XAF','Africa/Douala','DD/MM/YYYY','QR','CODE128',19.87,'barcode');
/*!40000 ALTER TABLE `organization_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `organizations`
--

DROP TABLE IF EXISTS `organizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `organizations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(180) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `status` enum('active','suspended','closed') NOT NULL DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `address` text,
  `phone` varchar(50) DEFAULT NULL,
  `slogan` varchar(255) DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `organizations`
--

LOCK TABLES `organizations` WRITE;
/*!40000 ALTER TABLE `organizations` DISABLE KEYS */;
INSERT INTO `organizations` VALUES (1,'Centre de Santé Démo','demo-health','active','2026-11-03 19:11:49',NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `organizations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `password_resets`
--

DROP TABLE IF EXISTS `password_resets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_resets` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `idx_reset_token` (`token_hash`),
  CONSTRAINT `password_resets_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `password_resets`
--

LOCK TABLES `password_resets` WRITE;
/*!40000 ALTER TABLE `password_resets` DISABLE KEYS */;
/*!40000 ALTER TABLE `password_resets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `patient_insurance_coverages`
--

DROP TABLE IF EXISTS `patient_insurance_coverages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patient_insurance_coverages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `patient_id` bigint unsigned NOT NULL,
  `insurer_id` bigint unsigned NOT NULL,
  `policy_number` varchar(120) NOT NULL,
  `member_number` varchar(120) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `coverage_percent` decimal(5,2) DEFAULT NULL,
  `notes` text,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_patient_coverages_patient` (`organization_id`,`patient_id`,`status`),
  KEY `idx_patient_coverages_insurer` (`organization_id`,`insurer_id`),
  KEY `patient_id` (`patient_id`),
  KEY `insurer_id` (`insurer_id`),
  CONSTRAINT `patient_insurance_coverages_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `patient_insurance_coverages_ibfk_2` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `patient_insurance_coverages_ibfk_3` FOREIGN KEY (`insurer_id`) REFERENCES `insurers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `patient_insurance_coverages`
--

LOCK TABLES `patient_insurance_coverages` WRITE;
/*!40000 ALTER TABLE `patient_insurance_coverages` DISABLE KEYS */;
/*!40000 ALTER TABLE `patient_insurance_coverages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `patient_medical_history`
--

DROP TABLE IF EXISTS `patient_medical_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patient_medical_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `patient_id` bigint unsigned NOT NULL,
  `condition_name` varchar(190) NOT NULL,
  `condition_code` varchar(80) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `status` enum('ongoing','resolved','in_remission') NOT NULL DEFAULT 'ongoing',
  `notes` text,
  `recorded_by` bigint unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_medical_history_patient` (`organization_id`,`patient_id`,`is_active`),
  KEY `idx_medical_history_condition` (`organization_id`,`condition_name`),
  KEY `patient_id` (`patient_id`),
  KEY `recorded_by` (`recorded_by`),
  CONSTRAINT `patient_medical_history_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `patient_medical_history_ibfk_2` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `patient_medical_history_ibfk_3` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `patient_medical_history`
--

LOCK TABLES `patient_medical_history` WRITE;
/*!40000 ALTER TABLE `patient_medical_history` DISABLE KEYS */;
/*!40000 ALTER TABLE `patient_medical_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `patients`
--

DROP TABLE IF EXISTS `patients`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patients` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `patient_code` varchar(80) NOT NULL,
  `full_name` varchar(190) NOT NULL,
  `birth_date` date DEFAULT NULL,
  `gender` enum('F','M','OTHER','UNSPECIFIED') NOT NULL DEFAULT 'UNSPECIFIED',
  `phone` varchar(50) DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  `address` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_patient_code_tenant` (`organization_id`,`patient_code`),
  KEY `idx_patients_tenant_name` (`organization_id`,`full_name`),
  CONSTRAINT `patients_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `patients`
--

LOCK TABLES `patients` WRITE;
/*!40000 ALTER TABLE `patients` DISABLE KEYS */;
INSERT INTO `patients` VALUES (1,1,'sdfsd','sdfsd','2026-11-10','M','1473073098','pecinu@mailinator.com','Officiis optio quis',1,'2026-11-04 15:34:06','2026-11-04 15:34:06');
/*!40000 ALTER TABLE `patients` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `plans`
--

DROP TABLE IF EXISTS `plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `plans` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(60) NOT NULL,
  `name` varchar(100) NOT NULL,
  `billing_interval` enum('monthly','annual','biennial') NOT NULL DEFAULT 'monthly',
  `monthly_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `currency` char(3) NOT NULL DEFAULT 'XAF',
  `max_users` int unsigned NOT NULL DEFAULT '5',
  `max_products` int unsigned NOT NULL DEFAULT '500',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `plan_type` enum('starter','ultimate','customized') NOT NULL DEFAULT 'customized',
  `annual_price` decimal(12,2) DEFAULT NULL,
  `biennial_price` decimal(12,2) DEFAULT NULL,
  `included_modules` json DEFAULT NULL,
  `module_prices` json DEFAULT NULL,
  `extra_user_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `plans`
--

LOCK TABLES `plans` WRITE;
/*!40000 ALTER TABLE `plans` DISABLE KEYS */;
INSERT INTO `plans` VALUES (1,'starter-monthly','Starter','monthly',15000.00,'XAF',5,500,0,'customized',NULL,NULL,NULL,NULL,0.00),(2,'starter','Starter','monthly',15000.00,'XAF',3,10000000,1,'starter',150000.00,280000.00,'[\"stock\", \"procurement\", \"sales\", \"cash\"]',NULL,5000.00),(3,'ultimate','Ultimate','monthly',25000.00,'XAF',5,10000000,1,'ultimate',350000.00,600000.00,'[\"stock\", \"procurement\", \"sales\", \"patients\", \"cash\", \"reports\", \"administration\", \"support\"]',NULL,5000.00),(4,'customized','Customized','monthly',0.00,'XAF',1,10000000,1,'customized',NULL,NULL,'[\"stock\", \"procurement\", \"sales\", \"patients\", \"cash\", \"reports\", \"administration\", \"support\"]','{\"cash\": {\"annual\": 120000, \"monthly\": 10000, \"biennial\": 240000}, \"sales\": {\"annual\": 120000, \"monthly\": 10000, \"biennial\": 240000}, \"stock\": {\"annual\": 120000, \"monthly\": 12000, \"biennial\": 240000}, \"reports\": {\"annual\": 120000, \"monthly\": 10000, \"biennial\": 240000}, \"support\": {\"annual\": 120000, \"monthly\": 10000, \"biennial\": 240000}, \"patients\": {\"annual\": 120000, \"monthly\": 10000, \"biennial\": 240000}, \"procurement\": {\"annual\": 120000, \"monthly\": 10000, \"biennial\": 240000}, \"administration\": {\"annual\": 120000, \"monthly\": 10000, \"biennial\": 240000}}',0.00);
/*!40000 ALTER TABLE `plans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `platform_faqs`
--

DROP TABLE IF EXISTS `platform_faqs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `platform_faqs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `question` varchar(255) NOT NULL,
  `answer` text NOT NULL,
  `category` varchar(100) NOT NULL DEFAULT 'Général',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `platform_faqs`
--

LOCK TABLES `platform_faqs` WRITE;
/*!40000 ALTER TABLE `platform_faqs` DISABLE KEYS */;
INSERT INTO `platform_faqs` VALUES (1,'Comment ajouter un produit ou corriger son stock ?','Ouvrez « Catalogue produits » pour créer ou modifier une fiche. Utilisez « Mouvements » pour enregistrer une entrée, une sortie ou un ajustement; chaque mouvement conserve sa traçabilité.','Stocks',10,1,'2026-11-04 23:23:40'),(2,'Comment scanner un produit à la vente ?','Dans le point de vente, utilisez « Scanner un code ». Une douchette USB/Bluetooth fonctionne comme un clavier; la caméra nécessite une autorisation du navigateur et une connexion HTTPS ou localhost.','Ventes',20,1,'2026-11-04 23:23:40'),(3,'Pourquoi une vente est-elle refusée ?','Une session de caisse doit être ouverte. Vérifiez aussi que le produit est actif, que sa quantité est suffisante et qu’une ordonnance est jointe lorsqu’elle est requise.','Ventes',30,1,'2026-11-04 23:23:40'),(4,'Comment récupérer mes données ?','Les propriétaires et administrateurs peuvent télécharger une sauvegarde JSON dans Paramètres > Sauvegarde & restauration. Les logos du dossier public/uploads/logos doivent être sauvegardés séparément.','Données',40,1,'2026-11-04 23:23:40'),(5,'Qui peut suivre une demande d’assistance ?','Chaque membre voit ses propres demandes. Les demandes de chat sont transmises à l’équipe REDAMS : un agent disponible peut les prendre en charge. Si aucun agent n’est disponible, le chat reste dans la file d’attente.','Assistance',50,1,'2026-11-04 23:23:40'),(6,'Comment gérer mon abonnement ?','Contactez l’équipe REDAMS depuis le chat d’assistance pour toute question sur votre forfait ou son renouvellement.','Abonnement',60,1,'2026-11-04 23:23:40'),(7,'Comment obtenir une formation ?','Consultez les ressources de formation dans Assistance ou contactez notre équipe pour organiser un accompagnement.','Formation',70,1,'2026-11-04 23:23:40');
/*!40000 ALTER TABLE `platform_faqs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `platform_invoices`
--

DROP TABLE IF EXISTS `platform_invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `platform_invoices` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `invoice_number` varchar(40) NOT NULL,
  `organization_id` bigint unsigned NOT NULL,
  `subscription_id` bigint unsigned NOT NULL,
  `promotion_id` bigint unsigned DEFAULT NULL,
  `period_start` date NOT NULL,
  `period_end` date NOT NULL,
  `subtotal` decimal(12,2) NOT NULL,
  `discount_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(12,2) NOT NULL,
  `currency` char(3) NOT NULL,
  `status` enum('draft','sent','paid','void') NOT NULL DEFAULT 'draft',
  `due_date` date NOT NULL,
  `paid_at` datetime DEFAULT NULL,
  `notes` varchar(500) DEFAULT NULL,
  `created_by` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invoice_number` (`invoice_number`),
  KEY `idx_platform_invoices_org` (`organization_id`,`created_at`),
  KEY `subscription_id` (`subscription_id`),
  KEY `promotion_id` (`promotion_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `platform_invoices_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `platform_invoices_ibfk_2` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions` (`id`),
  CONSTRAINT `platform_invoices_ibfk_3` FOREIGN KEY (`promotion_id`) REFERENCES `platform_promotions` (`id`),
  CONSTRAINT `platform_invoices_ibfk_4` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `platform_invoices`
--

LOCK TABLES `platform_invoices` WRITE;
/*!40000 ALTER TABLE `platform_invoices` DISABLE KEYS */;
/*!40000 ALTER TABLE `platform_invoices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `platform_promotions`
--

DROP TABLE IF EXISTS `platform_promotions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `platform_promotions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(60) NOT NULL,
  `name` varchar(120) NOT NULL,
  `discount_type` enum('percent','fixed') NOT NULL,
  `discount_value` decimal(12,2) NOT NULL,
  `starts_at` date NOT NULL,
  `ends_at` date DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  CONSTRAINT `platform_promotions_chk_1` CHECK ((`discount_value` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `platform_promotions`
--

LOCK TABLES `platform_promotions` WRITE;
/*!40000 ALTER TABLE `platform_promotions` DISABLE KEYS */;
/*!40000 ALTER TABLE `platform_promotions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `platform_settings`
--

DROP TABLE IF EXISTS `platform_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `platform_settings` (
  `setting_key` varchar(100) NOT NULL,
  `setting_value` json DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `platform_settings`
--

LOCK TABLES `platform_settings` WRITE;
/*!40000 ALTER TABLE `platform_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `platform_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `platform_trainings`
--

DROP TABLE IF EXISTS `platform_trainings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `platform_trainings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(180) NOT NULL,
  `description` text NOT NULL,
  `url` varchar(1000) DEFAULT NULL,
  `format` enum('article','video','link') NOT NULL DEFAULT 'article',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `platform_trainings`
--

LOCK TABLES `platform_trainings` WRITE;
/*!40000 ALTER TABLE `platform_trainings` DISABLE KEYS */;
/*!40000 ALTER TABLE `platform_trainings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `sku` varchar(80) NOT NULL,
  `barcode` varchar(120) DEFAULT NULL,
  `name` varchar(190) NOT NULL,
  `category` varchar(120) DEFAULT NULL,
  `unit` varchar(40) NOT NULL DEFAULT 'unité',
  `quantity_on_hand` decimal(14,3) NOT NULL DEFAULT '0.000',
  `reorder_level` decimal(14,3) NOT NULL DEFAULT '0.000',
  `sale_price` decimal(14,2) NOT NULL DEFAULT '0.00',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `prescription_required` tinyint(1) NOT NULL DEFAULT '0',
  `max_customer_quantity` decimal(14,3) DEFAULT NULL,
  `minimum_purchase_interval_hours` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_sku_tenant` (`organization_id`,`sku`),
  KEY `idx_product_tenant_name` (`organization_id`,`name`),
  KEY `idx_product_barcode` (`organization_id`,`barcode`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
INSERT INTO `products` VALUES (1,1,'MED-001','RDM1','Paracétamol 500 mg','Médicaments','boîte',33.000,10.000,1200.00,1,'2026-11-03 19:11:50','2026-11-04 17:00:04',0,NULL,NULL),(2,1,'MAT-001','RDM2','Gants nitrile M','Consommables','boîte',7.000,12.000,3500.00,1,'2026-11-03 19:11:50','2026-11-04 17:00:04',0,NULL,NULL),(3,1,'MAT-002','RDM3','Seringue 5 ml','Consommables','unité',119.000,30.000,150.00,1,'2026-11-03 19:11:50','2026-11-04 17:00:04',0,NULL,NULL);
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_order_items`
--

DROP TABLE IF EXISTS `purchase_order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_order_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `purchase_order_id` bigint unsigned NOT NULL,
  `product_id` bigint unsigned NOT NULL,
  `quantity_ordered` decimal(14,3) NOT NULL,
  `quantity_received` decimal(14,3) NOT NULL DEFAULT '0.000',
  `unit_cost` decimal(14,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_purchase_item_product` (`purchase_order_id`,`product_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `purchase_order_items_ibfk_1` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `purchase_order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_order_items`
--

LOCK TABLES `purchase_order_items` WRITE;
/*!40000 ALTER TABLE `purchase_order_items` DISABLE KEYS */;
INSERT INTO `purchase_order_items` VALUES (1,1,2,100.000,0.000,300.00,'2026-11-04 07:30:56'),(2,1,1,100.000,0.000,500.00,'2026-11-04 07:30:56');
/*!40000 ALTER TABLE `purchase_order_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_orders`
--

DROP TABLE IF EXISTS `purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_orders` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `supplier_id` bigint unsigned NOT NULL,
  `reference` varchar(120) DEFAULT NULL,
  `status` enum('draft','ordered','partially_received','received','cancelled') NOT NULL DEFAULT 'draft',
  `expected_date` date DEFAULT NULL,
  `notes` text,
  `created_by` bigint unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_purchase_reference_tenant` (`organization_id`,`reference`),
  KEY `idx_purchase_tenant_date` (`organization_id`,`created_at`),
  KEY `idx_purchase_tenant_status` (`organization_id`,`status`),
  KEY `supplier_id` (`supplier_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `purchase_orders_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `purchase_orders_ibfk_2` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `purchase_orders_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_orders`
--

LOCK TABLES `purchase_orders` WRITE;
/*!40000 ALTER TABLE `purchase_orders` DISABLE KEYS */;
INSERT INTO `purchase_orders` VALUES (1,1,1,'fm32','ordered','2026-11-03',NULL,1,'2026-11-04 07:30:56','2026-11-04 07:31:14');
/*!40000 ALTER TABLE `purchase_orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sales_invoice_items`
--

DROP TABLE IF EXISTS `sales_invoice_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_invoice_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `invoice_id` bigint unsigned NOT NULL,
  `product_id` bigint unsigned NOT NULL,
  `sku` varchar(80) NOT NULL,
  `product_name` varchar(190) NOT NULL,
  `unit` varchar(40) NOT NULL,
  `quantity` decimal(14,3) NOT NULL,
  `returned_quantity` decimal(14,3) NOT NULL DEFAULT '0.000',
  `unit_price` decimal(14,2) NOT NULL,
  `line_subtotal` decimal(14,2) NOT NULL,
  `line_tax` decimal(14,2) NOT NULL,
  `line_total` decimal(14,2) NOT NULL,
  `prescription_required` tinyint(1) NOT NULL DEFAULT '0',
  `prescription_provided` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sales_items_invoice` (`invoice_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `sales_invoice_items_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices` (`id`),
  CONSTRAINT `sales_invoice_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sales_invoice_items`
--

LOCK TABLES `sales_invoice_items` WRITE;
/*!40000 ALTER TABLE `sales_invoice_items` DISABLE KEYS */;
INSERT INTO `sales_invoice_items` VALUES (1,1,1,'MED-001','Paracétamol 500 mg','boîte',10.000,0.000,1200.00,12000.00,0.00,12000.00,0,0,'2026-11-04 16:09:52'),(2,2,2,'MAT-001','Gants nitrile M','boîte',1.000,0.000,3500.00,3500.00,0.00,3500.00,0,0,'2026-11-04 17:00:04'),(3,2,3,'MAT-002','Seringue 5 ml','unité',1.000,0.000,150.00,150.00,0.00,150.00,0,0,'2026-11-04 17:00:04'),(4,2,1,'MED-001','Paracétamol 500 mg','boîte',2.000,0.000,1200.00,2400.00,0.00,2400.00,0,0,'2026-11-04 17:00:04');
/*!40000 ALTER TABLE `sales_invoice_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sales_invoice_prescriptions`
--

DROP TABLE IF EXISTS `sales_invoice_prescriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_invoice_prescriptions` (
  `invoice_id` bigint unsigned NOT NULL,
  `mime_type` varchar(40) NOT NULL,
  `image_data` mediumblob NOT NULL,
  `captured_by` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`invoice_id`),
  KEY `captured_by` (`captured_by`),
  CONSTRAINT `sales_invoice_prescriptions_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices` (`id`),
  CONSTRAINT `sales_invoice_prescriptions_ibfk_2` FOREIGN KEY (`captured_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sales_invoice_prescriptions`
--

LOCK TABLES `sales_invoice_prescriptions` WRITE;
/*!40000 ALTER TABLE `sales_invoice_prescriptions` DISABLE KEYS */;
/*!40000 ALTER TABLE `sales_invoice_prescriptions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sales_invoices`
--

DROP TABLE IF EXISTS `sales_invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_invoices` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `invoice_number` varchar(40) NOT NULL,
  `patient_id` bigint unsigned DEFAULT NULL,
  `patient_name` varchar(190) DEFAULT NULL,
  `subtotal` decimal(14,2) NOT NULL,
  `tax_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
  `tax_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(14,2) NOT NULL,
  `status` enum('issued','partially_paid','paid','partially_returned','returned','cancelled') NOT NULL DEFAULT 'issued',
  `review_flags` json DEFAULT NULL,
  `notes` text,
  `created_by` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sales_invoice_number` (`organization_id`,`invoice_number`),
  KEY `idx_sales_invoice_tenant_date` (`organization_id`,`created_at`),
  KEY `idx_sales_invoice_patient` (`organization_id`,`patient_id`,`created_at`),
  KEY `idx_sales_invoice_status` (`organization_id`,`status`),
  KEY `patient_id` (`patient_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `sales_invoices_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `sales_invoices_ibfk_2` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `sales_invoices_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sales_invoices`
--

LOCK TABLES `sales_invoices` WRITE;
/*!40000 ALTER TABLE `sales_invoices` DISABLE KEYS */;
INSERT INTO `sales_invoices` VALUES (1,1,'FAC-20261104-000001',NULL,NULL,12000.00,0.00,0.00,12000.00,'paid',NULL,NULL,1,'2026-11-04 16:09:52'),(2,1,'FAC-20261104-000002',NULL,NULL,6050.00,0.00,0.00,6050.00,'paid',NULL,NULL,1,'2026-11-04 17:00:04');
/*!40000 ALTER TABLE `sales_invoices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sales_payments`
--

DROP TABLE IF EXISTS `sales_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_payments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `invoice_id` bigint unsigned NOT NULL,
  `payment_method` enum('cash','mobile_money','bank_transfer','insurance','other') NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `cash_received` decimal(14,2) NOT NULL DEFAULT '0.00',
  `cash_change` decimal(14,2) NOT NULL DEFAULT '0.00',
  `insurer_id` bigint unsigned DEFAULT NULL,
  `reference` varchar(190) DEFAULT NULL,
  `recorded_by` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sales_payments_invoice` (`invoice_id`),
  KEY `insurer_id` (`insurer_id`),
  KEY `recorded_by` (`recorded_by`),
  CONSTRAINT `sales_payments_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices` (`id`),
  CONSTRAINT `sales_payments_ibfk_2` FOREIGN KEY (`insurer_id`) REFERENCES `insurers` (`id`),
  CONSTRAINT `sales_payments_ibfk_3` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sales_payments`
--

LOCK TABLES `sales_payments` WRITE;
/*!40000 ALTER TABLE `sales_payments` DISABLE KEYS */;
INSERT INTO `sales_payments` VALUES (1,1,'cash',12000.00,12000.00,0.00,NULL,NULL,1,'2026-11-04 16:09:52'),(2,2,'cash',6050.00,6100.00,50.00,NULL,NULL,1,'2026-11-04 17:00:04');
/*!40000 ALTER TABLE `sales_payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sales_return_items`
--

DROP TABLE IF EXISTS `sales_return_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_return_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `return_id` bigint unsigned NOT NULL,
  `invoice_item_id` bigint unsigned NOT NULL,
  `quantity` decimal(14,3) NOT NULL,
  `refund_amount` decimal(14,2) NOT NULL,
  `restocked` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_sales_return_items_return` (`return_id`),
  KEY `idx_sales_return_items_invoice_item` (`invoice_item_id`),
  CONSTRAINT `sales_return_items_ibfk_1` FOREIGN KEY (`return_id`) REFERENCES `sales_returns` (`id`),
  CONSTRAINT `sales_return_items_ibfk_2` FOREIGN KEY (`invoice_item_id`) REFERENCES `sales_invoice_items` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sales_return_items`
--

LOCK TABLES `sales_return_items` WRITE;
/*!40000 ALTER TABLE `sales_return_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `sales_return_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sales_returns`
--

DROP TABLE IF EXISTS `sales_returns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_returns` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `invoice_id` bigint unsigned NOT NULL,
  `return_number` varchar(40) NOT NULL,
  `refund_amount` decimal(14,2) NOT NULL,
  `refund_method` enum('cash','mobile_money','bank_transfer','insurance','other') NOT NULL,
  `cash_received` decimal(14,2) NOT NULL DEFAULT '0.00',
  `cash_change` decimal(14,2) NOT NULL DEFAULT '0.00',
  `insurer_id` bigint unsigned DEFAULT NULL,
  `reason` varchar(500) NOT NULL,
  `recorded_by` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sales_return_number` (`invoice_id`,`return_number`),
  KEY `idx_sales_returns_invoice` (`invoice_id`,`created_at`),
  KEY `insurer_id` (`insurer_id`),
  KEY `recorded_by` (`recorded_by`),
  CONSTRAINT `sales_returns_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices` (`id`),
  CONSTRAINT `sales_returns_ibfk_2` FOREIGN KEY (`insurer_id`) REFERENCES `insurers` (`id`),
  CONSTRAINT `sales_returns_ibfk_3` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sales_returns`
--

LOCK TABLES `sales_returns` WRITE;
/*!40000 ALTER TABLE `sales_returns` DISABLE KEYS */;
/*!40000 ALTER TABLE `sales_returns` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `stock_movements`
--

DROP TABLE IF EXISTS `stock_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stock_movements` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `product_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `movement_type` enum('IN','OUT','ADJUSTMENT') NOT NULL,
  `quantity` decimal(14,3) NOT NULL,
  `reference` varchar(120) DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_moves_tenant_date` (`organization_id`,`created_at`),
  KEY `product_id` (`product_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `stock_movements_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `stock_movements_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `stock_movements_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `stock_movements`
--

LOCK TABLES `stock_movements` WRITE;
/*!40000 ALTER TABLE `stock_movements` DISABLE KEYS */;
INSERT INTO `stock_movements` VALUES (1,1,1,1,'OUT',10.000,'FAC-20261104-000001','Vente FAC-20261104-000001.','2026-11-04 16:09:52'),(2,1,2,1,'OUT',1.000,'FAC-20261104-000002','Vente FAC-20261104-000002.','2026-11-04 17:00:04'),(3,1,3,1,'OUT',1.000,'FAC-20261104-000002','Vente FAC-20261104-000002.','2026-11-04 17:00:04'),(4,1,1,1,'OUT',2.000,'FAC-20261104-000002','Vente FAC-20261104-000002.','2026-11-04 17:00:04');
/*!40000 ALTER TABLE `stock_movements` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `subscription_payments`
--

DROP TABLE IF EXISTS `subscription_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscription_payments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `subscription_id` bigint unsigned NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` char(3) NOT NULL,
  `payment_status` enum('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  `provider` varchar(60) DEFAULT NULL,
  `provider_reference` varchar(190) DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `subscription_id` (`subscription_id`),
  CONSTRAINT `subscription_payments_ibfk_1` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subscription_payments`
--

LOCK TABLES `subscription_payments` WRITE;
/*!40000 ALTER TABLE `subscription_payments` DISABLE KEYS */;
/*!40000 ALTER TABLE `subscription_payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `subscriptions`
--

DROP TABLE IF EXISTS `subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscriptions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `plan_id` bigint unsigned NOT NULL,
  `status` enum('trialing','active','past_due','suspended','cancelled') NOT NULL DEFAULT 'trialing',
  `billing_interval` enum('monthly','annual','biennial') NOT NULL DEFAULT 'monthly',
  `current_period_start` date NOT NULL,
  `current_period_end` date NOT NULL,
  `promotion_id` bigint unsigned DEFAULT NULL,
  `contract_amount` decimal(12,2) DEFAULT NULL,
  `max_users` int unsigned DEFAULT NULL,
  `selected_modules` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `plan_id` (`plan_id`),
  KEY `idx_subscription_tenant` (`organization_id`),
  KEY `fk_subscription_promotion` (`promotion_id`),
  CONSTRAINT `fk_subscription_promotion` FOREIGN KEY (`promotion_id`) REFERENCES `platform_promotions` (`id`),
  CONSTRAINT `subscriptions_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `subscriptions_ibfk_2` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subscriptions`
--

LOCK TABLES `subscriptions` WRITE;
/*!40000 ALTER TABLE `subscriptions` DISABLE KEYS */;
INSERT INTO `subscriptions` VALUES (1,1,1,'trialing','monthly','2026-11-03','2026-11-17',NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `subscriptions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `suppliers`
--

DROP TABLE IF EXISTS `suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `suppliers` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `name` varchar(190) NOT NULL,
  `contact_name` varchar(180) DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `address` text,
  `notes` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_suppliers_tenant_name` (`organization_id`,`name`),
  CONSTRAINT `suppliers_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `suppliers`
--

LOCK TABLES `suppliers` WRITE;
/*!40000 ALTER TABLE `suppliers` DISABLE KEYS */;
INSERT INTO `suppliers` VALUES (1,1,'MPMQSD','qsdqsd','qdsqdqs@qsdqs.qsdqs','sqqsd','sqdqsdsqdqsd','sqdqsdqs',1,'2026-11-04 07:29:59','2026-11-04 07:29:59');
/*!40000 ALTER TABLE `suppliers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `support_agent_presence`
--

DROP TABLE IF EXISTS `support_agent_presence`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `support_agent_presence` (
  `user_id` bigint unsigned NOT NULL,
  `is_available` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `support_agent_presence_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `support_agent_presence`
--

LOCK TABLES `support_agent_presence` WRITE;
/*!40000 ALTER TABLE `support_agent_presence` DISABLE KEYS */;
/*!40000 ALTER TABLE `support_agent_presence` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `support_ticket_messages`
--

DROP TABLE IF EXISTS `support_ticket_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `support_ticket_messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `ticket_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `message` text NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_support_messages_ticket` (`organization_id`,`ticket_id`,`created_at`),
  KEY `ticket_id` (`ticket_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `support_ticket_messages_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `support_ticket_messages_ibfk_2` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `support_ticket_messages_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `support_ticket_messages`
--

LOCK TABLES `support_ticket_messages` WRITE;
/*!40000 ALTER TABLE `support_ticket_messages` DISABLE KEYS */;
/*!40000 ALTER TABLE `support_ticket_messages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `support_tickets`
--

DROP TABLE IF EXISTS `support_tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `support_tickets` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `subject` varchar(190) NOT NULL,
  `message` text NOT NULL,
  `status` enum('open','in_progress','closed') NOT NULL DEFAULT 'open',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `support_token` char(32) DEFAULT NULL,
  `assigned_agent_id` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_support_ticket_token` (`support_token`),
  KEY `organization_id` (`organization_id`),
  KEY `user_id` (`user_id`),
  KEY `idx_support_queue` (`assigned_agent_id`,`status`,`created_at`),
  CONSTRAINT `fk_support_ticket_agent` FOREIGN KEY (`assigned_agent_id`) REFERENCES `users` (`id`),
  CONSTRAINT `support_tickets_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `support_tickets_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `support_tickets`
--

LOCK TABLES `support_tickets` WRITE;
/*!40000 ALTER TABLE `support_tickets` DISABLE KEYS */;
INSERT INTO `support_tickets` VALUES (1,1,1,'Chat assistance','ras for now','open','2026-11-04 22:55:44','4820780AF7F3C6CF020427852D1CB9D3',NULL);
/*!40000 ALTER TABLE `support_tickets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` bigint unsigned NOT NULL,
  `full_name` varchar(180) NOT NULL,
  `email` varchar(190) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('OWNER','ADMIN','PHARMACIST','STOREKEEPER','CASHIER','VIEWER','SUPER_ADMIN') NOT NULL DEFAULT 'VIEWER',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `password_version` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_tenant_email` (`organization_id`,`email`),
  KEY `idx_users_role_active` (`role`,`is_active`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,1,'Administrateur Démo','admin@demo.redams-stk.local','$2a$12$3tAA5toqdFPd9z7L02krUuzD2oubb7PY1.iuN.N6jeDSFaVm2SAvS','OWNER',1,'2026-11-03 19:11:50',0);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping events for database 'redams_stk'
--

--
-- Dumping routines for database 'redams_stk'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-05 10:15:25

-- Exclusivamente para un contenedor descartable creado por knowledge-mysql.mjs.
CREATE TABLE `KnowledgeQaFixture` (`id` VARCHAR(64) PRIMARY KEY, `marker` VARCHAR(64) NOT NULL);
CREATE TABLE `User` (
  `id` VARCHAR(191) PRIMARY KEY, `tenantId` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL, `status` VARCHAR(191) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE `AuditLog` (
  `id` VARCHAR(191) PRIMARY KEY, `tenantId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL, `action` VARCHAR(191) NOT NULL,
  `details` TEXT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
INSERT INTO `KnowledgeQaFixture` (`id`, `marker`) VALUES ('audit-failure', 'off');
DELIMITER $$
CREATE TRIGGER `knowledge_qa_audit_failure` BEFORE INSERT ON `AuditLog` FOR EACH ROW
BEGIN
  IF (SELECT marker FROM KnowledgeQaFixture WHERE id = 'audit-failure') = 'fail' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic editorial audit failure';
  END IF;
END$$
DELIMITER ;
CREATE TABLE `AssistantWaOutbox` (`id` VARCHAR(191) PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE `AssistantRun` (`id` VARCHAR(191) PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO `AssistantWaOutbox` (`id`) VALUES ('fixture-existing-outbox');
INSERT INTO `AssistantRun` (`id`) VALUES ('fixture-existing-run');
INSERT INTO `User` (`id`, `tenantId`, `name`, `role`, `status`) VALUES
  ('qa-editor-a', 'qa-editorial', 'Editora sintética A', 'SUPER_ADMIN', 'ACTIVE'),
  ('qa-editor-b', 'qa-editorial', 'Editor sintético B', 'SUPER_ADMIN', 'ACTIVE'),
  ('qa-editor-c', 'qa-other-editorial', 'Editora sintética C', 'SUPER_ADMIN', 'ACTIVE');

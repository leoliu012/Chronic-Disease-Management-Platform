-- ============================================================================
-- 前置机中间表 / 视图 DDL 参考
--
-- 用途：
--   - 这是慢病管理平台与院方对接 "前置机中间库" 模式的标准建议结构。
--   - 院方 DBA 在医院内网的 SQL Server 或 Oracle 服务器上建表 / 建视图，
--     用 Job / 触发器 / Linked Server 把 HIS 里的患者、诊断、检验、处方、出院数据
--     按下面的列名同步进来。
--   - 我们的 IntermediatePollerService 通过 IntermediateDbAdapter 接口
--     按 updated_at > since 增量拉取这五张表。
--
-- 关键约束：
--   - 每张表都必须有 updated_at (TIMESTAMP / DATETIME2)，且建索引，
--     这是增量同步的唯一依据。
--   - 所有患者标识统一用 hospital_patient_id (院内号) + id_card_no + phone，
--     与 NormalizedEvent.PatientIdentifier 对齐。
--   - 行级软删 (deleted = 1) 而不是物理删，方便审计 / 回放。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- SQL Server 版本
-- ----------------------------------------------------------------------------

CREATE TABLE dbo.HIS_PATIENT_VIEW (
    hospital_patient_id NVARCHAR(64)  NOT NULL,
    id_card_no          NVARCHAR(32)  NULL,
    phone               NVARCHAR(32)  NULL,
    name                NVARCHAR(64)  NOT NULL,
    gender              NVARCHAR(8)   NULL,           -- 'M' / 'F' / 'U' 或 '1' / '2' / '0'
    birth_date          DATE          NULL,
    address             NVARCHAR(256) NULL,
    updated_at          DATETIME2     NOT NULL,
    deleted             BIT           NOT NULL DEFAULT 0,
    CONSTRAINT PK_HIS_PATIENT_VIEW PRIMARY KEY (hospital_patient_id)
);
CREATE INDEX IX_HIS_PATIENT_VIEW_UPDATED ON dbo.HIS_PATIENT_VIEW (updated_at);

CREATE TABLE dbo.HIS_DIAGNOSIS_VIEW (
    diagnosis_id        BIGINT        NOT NULL,
    hospital_patient_id NVARCHAR(64)  NOT NULL,
    encounter_id        NVARCHAR(64)  NULL,
    icd10_code          NVARCHAR(32)  NULL,
    diagnosis_text      NVARCHAR(256) NOT NULL,
    diagnosed_at        DATETIME2     NOT NULL,
    is_main             BIT           NOT NULL DEFAULT 0,
    updated_at          DATETIME2     NOT NULL,
    CONSTRAINT PK_HIS_DIAGNOSIS_VIEW PRIMARY KEY (diagnosis_id)
);
CREATE INDEX IX_HIS_DIAGNOSIS_VIEW_UPDATED ON dbo.HIS_DIAGNOSIS_VIEW (updated_at);

CREATE TABLE dbo.HIS_LAB_RESULT_VIEW (
    lab_result_id       BIGINT         NOT NULL,
    hospital_patient_id NVARCHAR(64)   NOT NULL,
    item_code           NVARCHAR(64)   NOT NULL,
    item_name           NVARCHAR(128)  NOT NULL,
    value_num           DECIMAL(18, 4) NULL,
    value_text          NVARCHAR(128)  NULL,
    unit                NVARCHAR(16)   NULL,
    reference_range     NVARCHAR(64)   NULL,
    abnormal_flag       NVARCHAR(8)    NULL,         -- 'H' / 'L' / 'N' / 'HH' / 'LL' / 'A'
    reported_at         DATETIME2      NOT NULL,
    updated_at          DATETIME2      NOT NULL,
    CONSTRAINT PK_HIS_LAB_RESULT_VIEW PRIMARY KEY (lab_result_id)
);
CREATE INDEX IX_HIS_LAB_RESULT_VIEW_UPDATED ON dbo.HIS_LAB_RESULT_VIEW (updated_at);

CREATE TABLE dbo.HIS_PRESCRIPTION_VIEW (
    prescription_id     BIGINT         NOT NULL,
    hospital_patient_id NVARCHAR(64)   NOT NULL,
    drug_code           NVARCHAR(64)   NULL,
    drug_name           NVARCHAR(128)  NOT NULL,
    dosage              NVARCHAR(32)   NULL,
    frequency           NVARCHAR(64)   NULL,
    instructions        NVARCHAR(256)  NULL,
    start_date          DATE           NULL,
    end_date            DATE           NULL,
    prescribed_at       DATETIME2      NOT NULL,
    updated_at          DATETIME2      NOT NULL,
    CONSTRAINT PK_HIS_PRESCRIPTION_VIEW PRIMARY KEY (prescription_id)
);
CREATE INDEX IX_HIS_PRESCRIPTION_VIEW_UPDATED ON dbo.HIS_PRESCRIPTION_VIEW (updated_at);

CREATE TABLE dbo.HIS_DISCHARGE_VIEW (
    discharge_id        BIGINT         NOT NULL,
    hospital_patient_id NVARCHAR(64)   NOT NULL,
    encounter_id        NVARCHAR(64)   NULL,
    admission_time      DATETIME2      NULL,
    discharge_time      DATETIME2      NOT NULL,
    department          NVARCHAR(64)   NULL,
    diagnosis_icd       NVARCHAR(32)   NULL,
    diagnosis_text      NVARCHAR(256)  NULL,
    summary             NVARCHAR(MAX)  NULL,
    updated_at          DATETIME2      NOT NULL,
    CONSTRAINT PK_HIS_DISCHARGE_VIEW PRIMARY KEY (discharge_id)
);
CREATE INDEX IX_HIS_DISCHARGE_VIEW_UPDATED ON dbo.HIS_DISCHARGE_VIEW (updated_at);


-- ----------------------------------------------------------------------------
-- Oracle 版本 (语法等价，仅类型与索引语法不同)
-- ----------------------------------------------------------------------------

/*

CREATE TABLE HIS_PATIENT_VIEW (
    HOSPITAL_PATIENT_ID  VARCHAR2(64)   NOT NULL,
    ID_CARD_NO           VARCHAR2(32),
    PHONE                VARCHAR2(32),
    NAME                 NVARCHAR2(64)  NOT NULL,
    GENDER               VARCHAR2(8),
    BIRTH_DATE           DATE,
    ADDRESS              NVARCHAR2(256),
    UPDATED_AT           TIMESTAMP      NOT NULL,
    DELETED              NUMBER(1)      DEFAULT 0 NOT NULL,
    CONSTRAINT PK_HIS_PATIENT_VIEW PRIMARY KEY (HOSPITAL_PATIENT_ID)
);
CREATE INDEX IX_HIS_PATIENT_VIEW_UPDATED ON HIS_PATIENT_VIEW (UPDATED_AT);

CREATE TABLE HIS_DIAGNOSIS_VIEW (
    DIAGNOSIS_ID         NUMBER(19)     NOT NULL,
    HOSPITAL_PATIENT_ID  VARCHAR2(64)   NOT NULL,
    ENCOUNTER_ID         VARCHAR2(64),
    ICD10_CODE           VARCHAR2(32),
    DIAGNOSIS_TEXT       NVARCHAR2(256) NOT NULL,
    DIAGNOSED_AT         TIMESTAMP      NOT NULL,
    IS_MAIN              NUMBER(1)      DEFAULT 0 NOT NULL,
    UPDATED_AT           TIMESTAMP      NOT NULL,
    CONSTRAINT PK_HIS_DIAGNOSIS_VIEW PRIMARY KEY (DIAGNOSIS_ID)
);
CREATE INDEX IX_HIS_DIAGNOSIS_VIEW_UPDATED ON HIS_DIAGNOSIS_VIEW (UPDATED_AT);

CREATE TABLE HIS_LAB_RESULT_VIEW (
    LAB_RESULT_ID        NUMBER(19)     NOT NULL,
    HOSPITAL_PATIENT_ID  VARCHAR2(64)   NOT NULL,
    ITEM_CODE            VARCHAR2(64)   NOT NULL,
    ITEM_NAME            NVARCHAR2(128) NOT NULL,
    VALUE_NUM            NUMBER(18, 4),
    VALUE_TEXT           NVARCHAR2(128),
    UNIT                 VARCHAR2(16),
    REFERENCE_RANGE      VARCHAR2(64),
    ABNORMAL_FLAG        VARCHAR2(8),
    REPORTED_AT          TIMESTAMP      NOT NULL,
    UPDATED_AT           TIMESTAMP      NOT NULL,
    CONSTRAINT PK_HIS_LAB_RESULT_VIEW PRIMARY KEY (LAB_RESULT_ID)
);
CREATE INDEX IX_HIS_LAB_RESULT_VIEW_UPDATED ON HIS_LAB_RESULT_VIEW (UPDATED_AT);

CREATE TABLE HIS_PRESCRIPTION_VIEW (
    PRESCRIPTION_ID      NUMBER(19)     NOT NULL,
    HOSPITAL_PATIENT_ID  VARCHAR2(64)   NOT NULL,
    DRUG_CODE            VARCHAR2(64),
    DRUG_NAME            NVARCHAR2(128) NOT NULL,
    DOSAGE               VARCHAR2(32),
    FREQUENCY            VARCHAR2(64),
    INSTRUCTIONS         NVARCHAR2(256),
    START_DATE           DATE,
    END_DATE             DATE,
    PRESCRIBED_AT        TIMESTAMP      NOT NULL,
    UPDATED_AT           TIMESTAMP      NOT NULL,
    CONSTRAINT PK_HIS_PRESCRIPTION_VIEW PRIMARY KEY (PRESCRIPTION_ID)
);
CREATE INDEX IX_HIS_PRESCRIPTION_VIEW_UPDATED ON HIS_PRESCRIPTION_VIEW (UPDATED_AT);

CREATE TABLE HIS_DISCHARGE_VIEW (
    DISCHARGE_ID         NUMBER(19)     NOT NULL,
    HOSPITAL_PATIENT_ID  VARCHAR2(64)   NOT NULL,
    ENCOUNTER_ID         VARCHAR2(64),
    ADMISSION_TIME       TIMESTAMP,
    DISCHARGE_TIME       TIMESTAMP      NOT NULL,
    DEPARTMENT           NVARCHAR2(64),
    DIAGNOSIS_ICD        VARCHAR2(32),
    DIAGNOSIS_TEXT       NVARCHAR2(256),
    SUMMARY              CLOB,
    UPDATED_AT           TIMESTAMP      NOT NULL,
    CONSTRAINT PK_HIS_DISCHARGE_VIEW PRIMARY KEY (DISCHARGE_ID)
);
CREATE INDEX IX_HIS_DISCHARGE_VIEW_UPDATED ON HIS_DISCHARGE_VIEW (UPDATED_AT);

*/

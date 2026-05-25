/**
 * patient-auth-and-sign.controller.ts —— 已废弃 (DEPRECATED)
 * ===========================================================================
 *
 * 旧实现在这里提供了「扫码直达知情同意 + 一键签约」的两个端口：
 *   POST /patient-app/chronic-lead/lookup
 *   POST /patient-app/chronic-lead/sign
 *
 * 自 patient-self-consent-bind 改造起，扫码直达同意书的入口已被整体移除。
 * 所有患者统一通过小程序绑定入口完成：
 *   搜索院内信息 → 确认身份 → 签署知情同意书 → 提交绑定申请。
 *
 * 替代端口：
 *   POST /patient-app/identity/lookup   —— 见 PatientIdentityController
 *   POST /patient-app/consent/submit    —— 见 PatientIdentityController
 *   POST /patient-app/binding-requests  —— 见 PatientAppController
 *
 * 本文件保留为空壳仅为兼容旧的构建/导入路径；它不再注册任何路由，
 * 也不再被 PatientAppModule 引用。可在后续清理提交中安全删除。
 */

/** @deprecated 扫码签约链路已移除，请使用 PatientIdentityController。 */
export class PatientAuthAndSignController {}

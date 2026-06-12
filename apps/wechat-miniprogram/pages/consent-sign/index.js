/**
 * pages/consent-sign/index.js —— 知情同意书确认页
 *
 * patient-self-consent-bind：consent-sign 不再是扫码入口页，而是 bind 绑定流程
 * 中的一个步骤。由 pages/bind/index 携带识别参数（phone / hpid / id4）进入，
 * 不再依赖扫码参数 h。
 *
 * 本页职责：
 *   1) 用识别参数调用 /patient-app/identity/lookup 重新拉取患者快照；
 *   2) 展示知情同意书正文，患者勾选同意；
 *   3) 「同意并提交绑定申请」= 连续两步：
 *        POST /patient-app/consent/submit      （落独立 PatientConsent 记录）
 *        POST /patient-app/binding-requests    （提交绑定申请，命中邀约库则同步签约建档）
 *   4) 展示绑定申请提交结果（等待护士审核）。
 */

const { miniAuthRequest, persistPatientSession } = require('../../utils/request');

const BIND_REQUEST_TIMEOUT_MS = 180000;
const BIND_RECOVERY_RETRY_COUNT = 6;
const BIND_RECOVERY_RETRY_DELAY_MS = 1500;

// 提交绑定申请后，停留在结果页期间自动轮询审核状态，无需返回 / 重新进入。
const STATUS_POLL_INTERVAL_MS = 5000;

const RISK_LABEL = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危'
};

const DISEASE_LABEL = {
  HYPERTENSION: '高血压',
  TYPE_2_DIABETES: '2 型糖尿病',
  COPD: '慢性阻塞性肺病',
  CORONARY_HEART_DISEASE: '冠心病',
  HYPERLIPIDEMIA: '高脂血症',
  OBESITY: '肥胖症',
  OTHER: '慢病'
};

const SOURCE_LABEL = {
  HL7_DISCHARGE: '医院出院信息',
  HL7_OUTPATIENT: '门诊就诊信息',
  HL7_ABNORMAL_OBSERVATION: '化验/检验异常',
  FHIR_DISCHARGE: '出院信息（FHIR）',
  FHIR_ENCOUNTER: '门诊信息（FHIR）',
  FHIR_CONDITION: '诊断信息（FHIR）',
  FHIR_OBSERVATION: '化验信息（FHIR）',
  HIS_EVENT_DISCHARGE: '医院出院信息',
  HIS_EVENT_ENCOUNTER: '门诊信息',
  HIS_EVENT_LAB: '今日化验异常',
  INTERMEDIATE_DB: '医院前置机',
  MANUAL: '护士手工录入',
  HIS_STAGED: '院内系统暂存',
  EXISTING_PATIENT: '本院慢病档案'
};

const MATCH_TYPE_LABEL = {
  CHRONIC_LEAD: '邀约库 · 高危慢病线索',
  EXISTING_PATIENT: '本院已有慢病档案'
};

/**
 * 知情同意书正文纯文本快照，提交时回传后端存入 PatientConsent.consentTextSnapshot。
 * 与下方 wxml 中渲染的条款保持一致。
 */
const CONSENT_TEXT_SNAPSHOT = [
  '慢病管理知情同意与隐私授权协议',
  '一、加入慢病管理服务的目的：本院针对慢性病患者建立长期随访管理体系，通过定期电话随访、门诊复诊提醒、家庭血压/血糖远程监测和健康问卷，及时识别病情波动、提升用药依从性并改善长期预后。',
  '二、收集和使用的数据范围：1.您在本院产生的门诊/住院诊疗信息（含诊断、化验、检查、用药、出院小结）；2.您在小程序中主动上传的家庭血压、血糖、心率、体重、症状问卷等；3.您与护士/医生在随访过程中产生的对话和电子签名记录。',
  '三、数据的使用、共享与安全保护：1.数据仅用于本院慢病管理临床团队对您本人的诊疗与随访，不向第三方共享或出售；2.全部数据存储在本院 HIS/EMR 受控环境内，所有访问写入审计日志；3.您随时有权要求查看、更正或注销您的个人健康档案。',
  '四、授权本院主动联系我的方式：授权护士在工作时间（08:00-20:00）通过电话、短信、微信小程序消息方式联系我，进行随访、复测提醒和异常指标核实。',
  '五、撤回权：我可以随时通过小程序或拨打门诊办公室电话，要求暂停或永久退出慢病管理服务，已收集的数据将按照本院隐私规则进行匿名化或销毁处理。'
].join('\n');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(error) {
  const message = (error && error.message) || '';
  return /timeout|超时/i.test(message);
}

function labelOf(map, key) {
  return (key && map[key]) || key || '';
}

Page({
  data: {
    consentVersion: '',
    loading: true,
    submitting: false,
    recovering: false,

    // 识别参数（来自 bind 页面）
    phone: '',
    hospitalPatientId: '',
    idCardLast4: '',

    // 查询结果
    matched: false,
    matchType: '',
    matchTypeLabel: '',
    reason: '',
    chronicLeadId: '',
    matchedPatientId: '',
    alreadySigned: false,

    snapshot: null,
    riskLabel: '',
    diseaseLabel: '',
    sourceLabel: '',

    agreed: false,
    error: '',

    // 提交结果（绑定申请已提交 / 等待审核）
    success: false,
    successMessage: '',
    bindingApproved: false,
    patient: null
  },

  onLoad(options) {
    const safe = options || {};
    this.setData({
      phone: safe.phone || '',
      hospitalPatientId: safe.hpid || safe.hospitalPatientId || '',
      idCardLast4: safe.id4 || ''
    });
    this.lookup();
  },

  onShow() {
    // 返回结果页且尚未通过时，恢复审核状态轮询。
    if (this.data.success && !this.data.bindingApproved) {
      this.startStatusPolling();
    }
  },

  onHide() {
    this.stopStatusPolling();
  },

  onUnload() {
    this.stopStatusPolling();
  },

  /**
   * 提交绑定申请后，停留在结果页期间自动轮询审核状态。
   */
  startStatusPolling() {
    if (this._statusPollTimer) return;
    this._statusPollTimer = setInterval(() => {
      this.pollBindingStatus();
    }, STATUS_POLL_INTERVAL_MS);
  },

  stopStatusPolling() {
    if (this._statusPollTimer) {
      clearInterval(this._statusPollTimer);
      this._statusPollTimer = null;
    }
  },

  async pollBindingStatus() {
    try {
      const result = await miniAuthRequest({
        url: '/patient-app/session',
        method: 'POST',
        data: {}
      });
      persistPatientSession(result);

      if (result.bindingStatus === 'APPROVED') {
        this.stopStatusPolling();
        this.setData({
          bindingApproved: true,
          successMessage:
            '绑定申请已通过护士审核，您已成功加入本院慢病管理。\n' +
            '点击下方「进入慢病管理首页」即可查看本人档案、上传血压/血糖。'
        });
        wx.showToast({ title: '绑定申请已通过', icon: 'success' });
      } else if (result.bindingStatus === 'REJECTED') {
        this.stopStatusPolling();
        this.setData({
          successMessage:
            '绑定申请未通过护士审核，请返回绑定页核对手机号 / 院内号 / 身份证后四位后重新提交。'
        });
        wx.showToast({ title: '绑定申请未通过', icon: 'none' });
      }
    } catch (err) {
      // 轮询失败静默忽略，下个周期自动重试。
    }
  },

  buildLookupPayload() {
    const payload = {};
    if (this.data.phone) payload.phone = this.data.phone;
    if (this.data.hospitalPatientId) payload.hospitalPatientId = this.data.hospitalPatientId;
    if (this.data.idCardLast4) payload.idCardLast4 = this.data.idCardLast4;
    return payload;
  },

  applySnapshot(res) {
    const snapshot = res.snapshot || null;
    this.setData({
      matchType: res.matchType || '',
      matchTypeLabel: labelOf(MATCH_TYPE_LABEL, res.matchType),
      reason: res.reason || '',
      chronicLeadId: (res.chronicLead && res.chronicLead.id) || '',
      matchedPatientId: (res.patient && res.patient.id) || '',
      alreadySigned: !!res.alreadySigned,
      consentVersion: res.consentVersion || this.data.consentVersion,
      snapshot,
      riskLabel: snapshot ? labelOf(RISK_LABEL, snapshot.riskHint) : '',
      diseaseLabel: snapshot ? labelOf(DISEASE_LABEL, snapshot.suspectedDisease) || '未指定' : '',
      sourceLabel: snapshot ? labelOf(SOURCE_LABEL, snapshot.sourceChannel) : ''
    });
  },

  async lookup() {
    this.setData({ loading: true, error: '' });
    try {
      const payload = this.buildLookupPayload();
      if (!payload.phone && !payload.hospitalPatientId && !payload.idCardLast4) {
        this.setData({ loading: false, matched: false, reason: 'NEED_INPUT' });
        return;
      }

      const res = await miniAuthRequest({
        url: '/patient-app/identity/lookup',
        method: 'POST',
        data: payload
      });

      this.applySnapshot(res);

      const canBind =
        res.matchType === 'CHRONIC_LEAD' || res.matchType === 'EXISTING_PATIENT';
      this.setData({ loading: false, matched: canBind });
    } catch (err) {
      this.setData({
        loading: false,
        matched: false,
        error: err.message || '查询失败，请稍后重试'
      });
    }
  },

  refetch() {
    this.lookup();
  },

  toggleAgreed() {
    if (this.data.submitting) return;
    this.setData({ agreed: !this.data.agreed });
  },

  buildSuccessMessage(result) {
    const plan = result && result.followupPlan;
    const planText =
      plan && plan.taskCount > 0
        ? `系统已自动生成入组随访计划（共 ${plan.taskCount} 条）。`
        : '';
    return (
      `${(result && result.message) || '绑定申请已提交。'}\n` +
      `${planText}` +
      (planText ? '\n' : '') +
      '护士审核通过后，您即可在小程序首页查看本人慢病档案、上传血压/血糖。'
    );
  },

  applyBindingSuccess(result) {
    this.setData({
      submitting: false,
      recovering: false,
      success: true,
      error: '',
      successMessage: this.buildSuccessMessage(result),
      patient: (result && result.patient) || null
    });
    wx.showToast({ title: '绑定申请已提交', icon: 'success' });
    // 进入结果页后自动轮询审核状态，护士通过即自动更新，无需手动刷新。
    this.startStatusPolling();
  },

  /**
   * 提交绑定申请，命中邀约库时后端会同步签约建档（耗时较长），失败时重试。
   */
  async submitBindingRequest(consentId) {
    const payload = {
      phone: this.data.phone,
      hospitalPatientId: this.data.hospitalPatientId || undefined,
      idCardLast4: this.data.idCardLast4 || undefined,
      matchType: this.data.matchType,
      chronicLeadId: this.data.chronicLeadId || undefined,
      consentId
    };

    return miniAuthRequest({
      url: '/patient-app/binding-requests',
      method: 'POST',
      timeout: BIND_REQUEST_TIMEOUT_MS,
      data: payload
    });
  },

  /**
   * binding-requests 接口幂等：超时后重试不会重复建档。
   */
  async recoverBindingAfterTimeout(consentId) {
    this.setData({
      recovering: true,
      error: '请求超时，正在向后端确认绑定申请是否已提交，请不要重复点击。'
    });

    for (let i = 0; i < BIND_RECOVERY_RETRY_COUNT; i += 1) {
      await sleep(i === 0 ? 0 : BIND_RECOVERY_RETRY_DELAY_MS);
      try {
        const res = await this.submitBindingRequest(consentId);
        if (res && res.bindingRequest) return res;
      } catch (innerErr) {
        if (!isTimeoutError(innerErr)) throw innerErr;
      }
    }
    return null;
  },

  async submitSign() {
    if (this.data.submitting) return;
    if (!this.data.matched) {
      wx.showToast({ title: '未匹配到可绑定的院内信息', icon: 'none' });
      return;
    }
    if (!/^1\d{10}$/.test((this.data.phone || '').trim())) {
      this.setData({ error: '提交绑定申请需要手机号，请返回绑定页补充后重试。' });
      wx.showToast({ title: '请先返回绑定页补充手机号', icon: 'none' });
      return;
    }
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并勾选知情同意', icon: 'none' });
      return;
    }

    this.setData({ submitting: true, recovering: false, error: '' });

    try {
      // 第一步：签署知情同意书，落独立 PatientConsent 记录。
      const consent = await miniAuthRequest({
        url: '/patient-app/consent/submit',
        method: 'POST',
        data: {
          consentAccepted: true,
          consentVersion: this.data.consentVersion || '',
          matchType: this.data.matchType,
          chronicLeadId: this.data.chronicLeadId || undefined,
          patientId: this.data.matchedPatientId || undefined,
          hospitalPatientId: this.data.hospitalPatientId || undefined,
          consentTextSnapshot: CONSENT_TEXT_SNAPSHOT
        }
      });

      if (!consent || !consent.consentId) {
        throw new Error((consent && consent.message) || '知情同意书签署失败');
      }

      // 第二步：提交绑定申请（命中邀约库则同步签约建档 + 入组随访计划）。
      let result;
      try {
        result = await this.submitBindingRequest(consent.consentId);
      } catch (bindErr) {
        if (isTimeoutError(bindErr)) {
          const recovered = await this.recoverBindingAfterTimeout(consent.consentId);
          if (recovered) {
            this.applyBindingSuccess(recovered);
            return;
          }
        }
        throw bindErr;
      }

      if (!result || !result.bindingRequest) {
        throw new Error((result && result.message) || '提交绑定申请失败');
      }

      this.applyBindingSuccess(result);
    } catch (err) {
      this.setData({
        submitting: false,
        recovering: false,
        error: err.message || '提交失败，请稍后重试'
      });
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    }
  },

  backToBind() {
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.redirectTo({ url: '/pages/bind/index' });
      }
    });
  },

  goHome() {
    wx.switchTab({
      url: '/pages/home/index',
      fail() {
        wx.redirectTo({ url: '/pages/home/index' });
      }
    });
  }
});

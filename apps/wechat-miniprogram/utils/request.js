function getBaseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl || wx.getStorageSync('apiBaseUrl') || 'http://127.0.0.1:3000';
}

function getPatientToken() {
  const app = getApp();
  return app.globalData.patientToken || wx.getStorageSync('patientToken') || '';
}

function getDemoOpenId() {
  const app = getApp();
  let demoOpenId = app.globalData.demoOpenId || wx.getStorageSync('demoOpenId') || '';
  if (!demoOpenId) {
    demoOpenId = `demo-openid-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    app.globalData.demoOpenId = demoOpenId;
    wx.setStorageSync('demoOpenId', demoOpenId);
  }
  return demoOpenId;
}

function clearPatientSession() {
  const app = getApp();
  app.globalData.patientToken = '';
  app.globalData.patientId = '';
  app.globalData.patient = null;
  app.globalData.bindingStatus = 'UNBOUND';
  wx.removeStorageSync('patientToken');
  wx.removeStorageSync('patientId');
  wx.removeStorageSync('patient');
  wx.setStorageSync('bindingStatus', 'UNBOUND');
}

function persistPatientSession(payload) {
  const app = getApp();
  const patient = payload && payload.patient;
  const token = payload && payload.patientToken;
  const demoOpenId = (payload && payload.demoOpenId) || getDemoOpenId();
  const bindingStatus = (payload && payload.bindingStatus) || 'UNBOUND';

  app.globalData.demoOpenId = demoOpenId;
  app.globalData.bindingStatus = bindingStatus;
  wx.setStorageSync('demoOpenId', demoOpenId);
  wx.setStorageSync('bindingStatus', bindingStatus);

  if (token && patient && patient.id) {
    app.globalData.patientToken = token;
    app.globalData.patientId = patient.id;
    app.globalData.patient = patient;
    wx.setStorageSync('patientToken', token);
    wx.setStorageSync('patientId', patient.id);
    wx.setStorageSync('patient', patient);
  }
}

function buildQuery(query) {
  if (!query) return '';
  const pairs = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

function request(options) {
  const url = `${getBaseUrl()}${options.url}${buildQuery(options.query)}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: options.method || 'GET',
      data: options.data || undefined,
      header: {
        'content-type': 'application/json',
        ...(options.header || {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }

        const message =
          (res.data && (res.data.message || res.data.error)) ||
          `请求失败：HTTP ${res.statusCode}`;
        reject(new Error(Array.isArray(message) ? message.join('；') : message));
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络请求失败，请检查 API 地址和后端服务'));
      }
    });
  });
}

function patientRequest(options) {
  const token = getPatientToken();
  if (!token) {
    return Promise.reject(new Error('请先完成患者身份绑定并等待护士审核'));
  }

  return request({
    ...options,
    url: `/patient-app${options.url}`,
    header: {
      ...(options.header || {}),
      'X-Patient-Token': token
    }
  }).catch((error) => {
    if (/token|session|401|Unauthorized|expired/i.test(error.message || '')) {
      clearPatientSession();
    }
    throw error;
  });
}

module.exports = {
  request,
  patientRequest,
  getBaseUrl,
  getPatientToken,
  getDemoOpenId,
  clearPatientSession,
  persistPatientSession
};

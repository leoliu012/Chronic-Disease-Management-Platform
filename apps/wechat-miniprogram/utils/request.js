let env = require('../env.example');
try {
  env = require('../env');
} catch (error) {
  console.warn('Missing env.js, run: node apps/wechat-miniprogram/scripts/sync-env.js');
}

function getBaseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl || wx.getStorageSync('apiBaseUrl') || env.apiBaseUrl;
}

function getPatientToken() {
  const app = getApp();
  return app.globalData.patientToken || wx.getStorageSync('patientToken') || '';
}

function getMiniSessionToken() {
  const app = getApp();
  return app.globalData.miniSessionToken || wx.getStorageSync('miniSessionToken') || '';
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

function clearMiniSession() {
  const app = getApp();
  app.globalData.miniSessionToken = '';
  app.globalData.miniSessionExpiresAt = '';
  wx.removeStorageSync('miniSessionToken');
  wx.removeStorageSync('miniSessionExpiresAt');
}

function resetPatientIdentity() {
  clearPatientSession();
  clearMiniSession();
}

function persistMiniSession(payload) {
  const app = getApp();
  if (payload && payload.miniSessionToken) {
    app.globalData.miniSessionToken = payload.miniSessionToken;
    app.globalData.miniSessionExpiresAt = payload.expiresAt || '';
    wx.setStorageSync('miniSessionToken', payload.miniSessionToken);
    wx.setStorageSync('miniSessionExpiresAt', payload.expiresAt || '');
  }
  if (payload && payload.bound) {
    app.globalData.bindingStatus = 'APPROVED';
    wx.setStorageSync('bindingStatus', 'APPROVED');
  }
  return payload;
}

function persistPatientSession(payload) {
  const app = getApp();
  const patient = payload && payload.patient;
  const token = payload && payload.patientToken;
  const bindingStatus = (payload && payload.bindingStatus) || 'UNBOUND';

  app.globalData.bindingStatus = bindingStatus;
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

const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_WRITE_REQUEST_TIMEOUT_MS = 120000;

function isWriteMethod(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes((method || 'GET').toUpperCase());
}

function getRequestTimeout(options) {
  if (typeof options.timeout === 'number' && options.timeout > 0) return options.timeout;
  return isWriteMethod(options.method) ? DEFAULT_WRITE_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
}

function normalizeRequestError(err) {
  const raw = (err && (err.errMsg || err.message)) || '';
  if (/timeout/i.test(raw)) {
    return new Error('请求超时：后端可能仍在处理中，请稍后刷新确认结果');
  }
  if (/fail|request/i.test(raw)) {
    return new Error(raw || '网络请求失败，请检查 API 地址和后端服务');
  }
  return new Error(raw || '网络请求失败，请检查 API 地址和后端服务');
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
      timeout: getRequestTimeout(options),
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
        reject(normalizeRequestError(err));
      }
    });
  });
}

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(loginRes) {
        if (!loginRes.code) {
          reject(new Error('wx.login 未返回 code'));
          return;
        }
        resolve(loginRes.code);
      },
      fail: reject
    });
  });
}

async function createMiniSession() {
  const code = await wxLogin();
  const payload = await request({
    url: '/patient-app/wechat-mini/session',
    method: 'POST',
    data: { code }
  });
  if (!payload || !payload.miniSessionToken) {
    throw new Error('后端未返回 miniSessionToken');
  }
  return persistMiniSession(payload);
}

async function ensureMiniSession() {
  const token = getMiniSessionToken();
  const expiresAt = wx.getStorageSync('miniSessionExpiresAt');
  if (token && expiresAt && new Date(expiresAt).getTime() > Date.now() + 60 * 1000) {
    return token;
  }
  const session = await createMiniSession();
  return session.miniSessionToken;
}

async function miniAuthRequest(options) {
  const token = await ensureMiniSession();
  return request({
    ...options,
    header: {
      ...(options.header || {}),
      'x-mini-session-token': token
    }
  }).catch(async (error) => {
    if (/mini session|x-mini-session-token|401|Unauthorized|expired/i.test(error.message || '')) {
      clearMiniSession();
      const nextToken = await ensureMiniSession();
      return request({
        ...options,
        header: {
          ...(options.header || {}),
          'x-mini-session-token': nextToken
        }
      });
    }
    throw error;
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

function openMiniProgramPage(url, options) {
  const opts = options || {};
  if (!url) {
    wx.showToast({ title: '页面地址为空', icon: 'none' });
    return;
  }

  const onFail = opts.onFail || function fallbackFailed(err) {
    wx.showToast({
      title: (err && err.errMsg) || '无法打开页面，请检查 app.json 页面配置',
      icon: 'none'
    });
  };

  wx.navigateTo({
    url,
    success: opts.success,
    fail(firstErr) {
      wx.redirectTo({
        url,
        success: opts.success,
        fail(secondErr) {
          wx.reLaunch({
            url,
            success: opts.success,
            fail(thirdErr) {
              wx.switchTab({
                url,
                success: opts.success,
                fail() {
                  onFail(thirdErr || secondErr || firstErr);
                }
              });
            }
          });
        }
      });
    }
  });
}

module.exports = {
  request,
  miniAuthRequest,
  patientRequest,
  getBaseUrl,
  getPatientToken,
  getMiniSessionToken,
  createMiniSession,
  ensureMiniSession,
  clearPatientSession,
  clearMiniSession,
  resetPatientIdentity,
  persistMiniSession,
  persistPatientSession,
  openMiniProgramPage,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_WRITE_REQUEST_TIMEOUT_MS
};

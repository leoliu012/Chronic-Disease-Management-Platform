function isIgnoredWeChatSdkError(error) {
  const text = String((error && (error.errMsg || error.message)) || error || '');
  return /webapi_getwxaasyncsecinfo|appServiceSDKScriptError/i.test(text);
}

let env = require('./env.example');
try {
  env = require('./env');
} catch (error) {
  console.warn('Missing env.js, run: node apps/wechat-miniprogram/scripts/sync-env.js');
}
const DEFAULT_API_BASE_URL = env.apiBaseUrl;

App({
  globalData: {
    // iOS 真机如果无法访问 127.0.0.1，需要改成电脑局域网 IP，例如 http://192.168.1.20:3000
    apiBaseUrl: DEFAULT_API_BASE_URL,
    miniSessionToken: '',
    miniSessionExpiresAt: '',
    patientToken: '',
    patientId: '',
    patient: null,
    bindingStatus: 'UNBOUND'
  },

  onLaunch() {
    const apiBaseUrl = wx.getStorageSync('apiBaseUrl');
    const miniSessionToken = wx.getStorageSync('miniSessionToken');
    const miniSessionExpiresAt = wx.getStorageSync('miniSessionExpiresAt');
    const patientToken = wx.getStorageSync('patientToken');
    const patientId = wx.getStorageSync('patientId');
    const patient = wx.getStorageSync('patient');
    const bindingStatus = wx.getStorageSync('bindingStatus');

    if (apiBaseUrl && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(apiBaseUrl)) {
      this.globalData.apiBaseUrl = apiBaseUrl;
    } else {
      this.globalData.apiBaseUrl = DEFAULT_API_BASE_URL;
      wx.setStorageSync('apiBaseUrl', DEFAULT_API_BASE_URL);
    }
    if (miniSessionToken) this.globalData.miniSessionToken = miniSessionToken;
    if (miniSessionExpiresAt) this.globalData.miniSessionExpiresAt = miniSessionExpiresAt;
    if (patientToken) this.globalData.patientToken = patientToken;
    if (patientId) this.globalData.patientId = patientId;
    if (patient) this.globalData.patient = patient;
    if (bindingStatus) this.globalData.bindingStatus = bindingStatus;
  },

  onError(error) {
    // 微信开发者工具偶发的 SDK 安全信息错误，不是业务代码异常。
    // 过滤后避免遮挡真实的小程序页面交互；真实业务错误仍然输出。
    if (isIgnoredWeChatSdkError(error)) {
      console.warn('[ignored WeChat DevTools SDK error]', error);
      return;
    }
    console.error(error);
  },

  onUnhandledRejection(event) {
    const reason = event && event.reason;
    if (isIgnoredWeChatSdkError(reason)) {
      console.warn('[ignored WeChat DevTools SDK rejection]', reason);
      return;
    }
    console.error(reason || event);
  }
});

function getBaseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl || wx.getStorageSync('apiBaseUrl') || 'http://127.0.0.1:3000';
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

module.exports = {
  request,
  getBaseUrl
};

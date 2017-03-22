"use strict";

const url = require('url');
const _request = require('request');
const BufferHelper = require('bufferhelper');
const packageInfo = require('../package.json');

/**
 * 发送请求
 * @param opt {Object}
 * @param retryTimes internal use
 * @return {Promise}
 */
export function request(opt, retryTimes = 0) {
  return new Promise((resolve, reject) => {
    const url = encodeURI(opt.url.replace(/%/g, '(precent)')).replace(/\(precent\)/g, '%');
    const ignoreBody = opt.method == 'HEAD' && opt.useFakeHead;
    const newOpt = Object.assign({}, opt, { url });

    if (ignoreBody) {
      newOpt.method = 'GET';
    }

    const buffer = new BufferHelper();
    let response;
    const req = _request(newOpt)
      .on('response', res => {
        response = res;
        if (ignoreBody) {
          req.abort();
          resolve(response);
        }
      })
      .on('error', reject);

    if (!ignoreBody) {
      req
        .on('data', data => {
          buffer.concat(data);
        })
        .on('end', () => {
          response.body = buffer.toBuffer().toString();
          resolve(response);
        });
    }
  }).catch(error => {
    if (['ECONNRESET', 'ESOCKETTIMEDOUT'].includes(error.code) &&
      retryTimes < opt.retryTimes) {
      return request(opt, retryTimes + 1);
    } else {
      throw error;
    }
  });
}

/**
 * 获取链接内容
 * @param link {String}
 * @param opt {Object}
 * @return {{
 *   host: String,
 *   href: String,
 *   body: String,
 *   headers: String[],
 *   statusCode: int,
 *   redirect: String[]
 * }}
 * @throws Error
 */
export async function fetch(link, opt = {}) {
  opt = Object.assign({
    timeout: 10000,
    retryTimes: 5,
    redirectTimes: 10,
    followRedirect: true,
    requestMethod: 'HEAD',
    useFakeHead: true,
    requestAcceptEncoding: 'gzip, deflate, sdch',
    requestAcceptLanguage: 'zh-CN,zh;q=0.8,en;q=0.6,zh-TW;q=0.4',
    requestAccept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    requestCacheControl: 'no-cache',
    requestConnection: 'keep-alive',
    requestUserAgent: `Mozilla/5.0 (Windows NT 5.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.101 Safari/537.36 Huatuo/${packageInfo.version}`,
  }, opt);

  const requestOpt = {
    url: link,
    retryTimes: opt.retryTimes,
    method: opt.requestMethod.toUpperCase(),
    useFakeHead: opt.useFakeHead,
    timeout: opt.timeout,
    followRedirect: false,
    proxy: opt.proxy || process.env.http_proxy || process.env.HTTP_PROXY,
    gzip: opt.requestAcceptEncoding.toLowerCase().includes('gzip'),
    headers: {
      'Accept-Encoding': opt.requestAcceptEncoding,
      'Accept-Language': opt.requestAcceptLanguage,
      'User-Agent': opt.requestUserAgent,
      'Accept': opt.requestAccept,
      'Cache-Control': opt.requestCacheControl,
      'Connection': opt.requestConnection
    }
  };

  if (opt.requestReferer) {
    requestOpt.headers.Referer = opt.requestReferer;
  }

  if (opt.redirectTimes <= 0) {
    throw new Error('Redirect requests as the maximum number of redirects allowed.');
  }

  let response = await request({ ...requestOpt });

  if (response.statusCode == 405 && !opt.useFakeHead) {
    response = await request({ ...requestOpt, method: 'GET' });
  }

  if (opt.followRedirect && [301, 302, 307].includes(response.statusCode)) {
    const location = url.resolve(link, response.headers.location);
    return await fetch(location, Object.assign(opt, { redirectTimes: opt.redirectTimes - 1 }))
      .then(result => {
        result.href = response.request.href;
        result.redirect.unshift([response.statusCode, location]);
        return result;
      });
  }

  return {
    host: response.request.host,
    href: response.request.href,
    body: response.body,
    headers: response.headers,
    statusCode: response.statusCode,
    redirect: []
  };
}

/**
 * 链接标准化
 * @param link {String}
 * @param [baseUrl = null] {String}
 * @param [removeHash = null] {Boolean}
 * @return {String}
 */
export function normalizeLink(link, baseUrl = null, removeHash = true) {
  if (baseUrl === null) {
    baseUrl = link;
  }

  const info = url.parse(link);
  if (info.protocol && !['http:', 'https:'].includes(info.protocol)) {
    return baseUrl;
  }

  link = url.resolve(baseUrl, link);
  if (removeHash && link.includes('#')) {
    link = link.substr(0, link.indexOf('#'));
  }

  return link;
}

/**
 * 获取base.href
 * @param content {String}
 * @return {String|null}
 */
export function fetchBaseUrl(content) {
  try {
    const [, tag] = content.match(/<base ([^>]*?)>/);
    const [,, href] = tag.match(/href=(['"]?)([^'"]+)\1/);
    return href;
  } catch(e) {
    return null;
  }
}

/**
 * 提纯HTML，多虑多余标签
 * @param content {String}
 * @return {String}
 */
export function pureHTML(content) {
  content = content.replace(/<script[\s\S]+?<\/script>/g, '');
  return content;
}

/**
 * 从HTML中提取链接
 * @param content {String}
 * @param baseUrl {String}
 * @param regex {RegExp}
 * @param groupId {int}
 * @return {String[]}
 */
export function parseHTML(content, baseUrl, regex, groupId) {
  const links = new Set();
  let match;

  while(match = regex.exec(content)) {
    links.add(normalizeLink(match[groupId], baseUrl));
  }

  links.delete(normalizeLink(baseUrl));

  return [...links];
}

/**
 * 批量检查链接
 * @param links {String[]}
 * @param opt {Object}
 * @return {Promise.<{success: Map, failed: Map}>}
 */
export async function checkLinks(links, opt = {}) {
  let index = 0;

  if (!Array.isArray(links)) {
    throw new Error('the first argument should be a array');
  }

  const result = {
    success: new Map(),
    error: new Map()
  };

  opt = Object.assign({
    thread: 10,
    validators: []
  }, opt);

  const connect = () => {
    const link = links[index++];

    return link === undefined ?
      Promise.resolve() :
      fetch(link, opt)
        .then(response => {
          let success = false;
          for (let i=0; i<opt.validators.length && !success; i++) {
            opt.validators[i](
              response,
              () => success = true,
              error => { throw new Error(error) }
            );
          }
          if (!success && response.statusCode !== 200) {
            throw new Error('Http status code ' + response.statusCode);
          }
          return response;
        })
        .then(response => {
          const redirect = response.redirect.map(r => `${r[0]}=>${r[1]}`);
          result.success.set(link, [...redirect, response.statusCode].join('|'));
        }, error => {
          result.error.set(link, new Error(error.message));
        })
        .then(connect);
  };

  const connects = new Array(opt.thread).fill(0).map(_ => connect());

  return Promise.all(connects).then(() => result);
}

/**
 * 校验网页链接
 * @param url {String}
 * @param modules {String[]|Object[]|Array[]}
 * @param [opt = {}] {Object}
 * @return {Map}
 */
export async function check(url, modules, opt = {}) {

  // 兼容单个配置的情况
  if (typeof modules == 'object' && modules != null && modules.name){
    modules = [modules];
  } else if (!Array.isArray(modules) || modules.length == 0) {
    throw new Error('Module config is incorrect');
  } else if (modules.length == 2 &&
    typeof modules[0] == 'string' &&
    typeof modules[1] == 'object') {
    modules = [modules];
  }

  // 配置标准化
  const options = new Map(modules.map(item => {
    let name, config;

    if (Array.isArray(item) && item.length == 2) {// [ module_name, config ]
      [name, config] = item;
    } else if (typeof item == 'object' && item !== null && item.name) {// { name: module_name, ...other }
      [name, config] = [item.name, item];
    } else {
      throw new Error('Module is incorrect');
    }

    if (!name || typeof name !== 'string') {
      throw new Error('Module name is incorrect');
    }

    if (typeof config != 'object' || config === null) {
      throw new Error('You must set a config Object.');
    } else if (config.parser) {// 优先取parser
      if (typeof config.parser != 'function') {
        throw new Error('Parser must be a function!');
      }
      return [name, config];
    } else if (config.regex) {// 取不到parser则取regex
      let regex, groupId;
      if (config.regex instanceof RegExp) {
        regex = config.regex;
        groupId = 0;
      } else if (Array.isArray(config.regex)) {
        if (!config.regex[0] instanceof RegExp) {
          throw new Error('Regular expression is incorrect!');
        } else if (!Number.isInteger(config.regex[1])) {
          throw new Error('Regular expression group id is incorrect!');
        }
        [regex, groupId] = config.regex;
      } else {
        throw new Error('Regular expression is incorrect!');
      }

      config = Object.assign({
        parser: (html, baseUrl) => parseHTML(html, baseUrl, regex, groupId)
      }, opt, config);

      return [name, config];
    } else {
      throw new Error('Module argument is incorrect.');
    }
  }));

  // 获取页面
  const response = await fetch(url, { requestMethod: 'GET' });

  if (!response.body) {
    throw new Error('Page body is empty, Status Code ' + response.statusCode);
  }

  const html = pureHTML(response.body);
  const baseUrl = fetchBaseUrl(html) || url;

  const promises = Array.from(options)
    .map(([name, config]) => {
    return checkLinks(config.parser(html, baseUrl), config).then(result => [name ,result])
  });

  return await Promise.all(promises).then(result => new Map(result));
}

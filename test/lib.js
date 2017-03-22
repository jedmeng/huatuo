"use strict";

const { expect } = require('chai');
const fs = require('fs');
const url = require('url');
const http = require('http');
const path = require('path');
const querystring = require('querystring');
const huatuo = require('../src/lib');
const modules = require('../src/modules');

let buildUrl, baseUrl;

before(done => {
  http.createServer((req, res) => {
    const urlInfo = url.parse(req.url.toLowerCase());
    const query = querystring.parse(urlInfo.query);
    const data = {
      url: req.url,
      httpVersion: req.httpVersion,
      method: req.method,
      headers: req.headers,
    };
    if (!query.statuscode && query.jump) {
      query.statuscode = 301;
    }
    if (query.jump) {
      res.setHeader('location', query.jump);
    }
    if (query.destroy) {
      res.destroy();
    }
    res.setHeader('request', JSON.stringify(data));
    res.writeHead(query.statuscode || 200);
    if (query.file) {
      const fp = path.join(__dirname, 'resource', query.file);
      fs.readFile(fp, 'utf-8', (error, content) => {
        if (error) {
          throw error;
        } else {
          res.end(content.replace(/\{baseUrl\}/g, baseUrl), 'utf-8');
        }
      });
    } else if (query) {
      res.end(query.body, 'utf-8');
    }
  }).listen(0, function () {
    baseUrl = `http://localhost:${this.address().port}`;
    buildUrl = (query = {}) => `${baseUrl}/?${querystring.stringify(query)}`;
    done();
  })
});

describe('测试 fetch()', () => {
  const { fetch } = huatuo;

  it('正常请求', () => {
    const body = 'hello world';
    const url = buildUrl({ body });
    return fetch(url, { requestMethod: 'GET' })
      .then(response => {
        expect(response.host).to.equal('localhost');
        expect(response.href).to.equal(url);
        expect(response.body).to.equal(body);
        expect(response.headers.request).to.not.be.empty;
        expect(response.statusCode).to.equal(200);
        expect(response.redirect).to.be.instanceof(Array);
        expect(response.redirect).to.be.empty;
      })
  });

  it('重定向', () => {
    const redirectUrl = buildUrl({ statuscode: 302, jump: buildUrl({ jump: buildUrl() }) });

    return fetch(redirectUrl)
      .then(response => {
        expect(response.href).to.equal(redirectUrl);
        expect(response.redirect.length).to.equal(2);
        expect(response.redirect[0][0]).to.equal(302);
        expect(response.redirect[1][1]).to.equal(buildUrl());
      });
  });

  it('重定向超限', () => {
    return fetch(buildUrl({ jump: buildUrl({ jump: buildUrl() }) }), { redirectTimes: 2 })
      .then(() => Promise.reject('应抛异常'), () => {});
  });

  it('使用HEAD请求时，收到405后重新请求', () => {
    return fetch(buildUrl({ statuscode: 405 }), { useFakeHead: false })
      .then(response => {
        const req = JSON.parse(response.headers.request);
        expect(req.method).equal('GET');
      });
  });

  it('测试携带referer', () => {
    const referer = 'http://test.com';
    return fetch(buildUrl( {file: 'list.html'}), {
      requestReferer: referer
    }).then(response => {
      const req = JSON.parse(response.headers.request);
      expect(req.headers.referer).to.equal(referer);
    });
  })
});

describe('测试 request()', () => {
  const { request } = huatuo;

  it('正常请求', () => {
    return request({ url: buildUrl() });
  });

  it('异常请求', () => {
    return request({ url: buildUrl({ destroy: 1 }) })
      .then(() => Promise.reject('应抛异常'), () => {});
  });

  it ('fake head', () => {
    return Promise.all([
      request({ url: buildUrl(), method: 'HEAD', useFakeHead: true })
        .then(response => {
          const req = JSON.parse(response.headers.request);
          expect(req.method).to.equal('GET');
          expect(response.body).to.be.empty;
        }),
      request({ url: buildUrl(), method: 'HEAD', useFakeHead: false })
        .then(response => {
          const req = JSON.parse(response.headers.request);
          expect(req.method).to.equal('HEAD');
        })
      ]);
  });

  it('中文参数', () => {
    const query = 'a=你好&b=世界';

    return request({ url: `${baseUrl}?${query}` })
      .then(response => {
        const req = JSON.parse(response.headers.request);
        expect(url.parse(req.url).query).to.equal(encodeURI(query));
      });
  });

});

describe('测试 normaliseLink()', () => {
  const { normalizeLink } = huatuo;

  it('标准http和https绝对链接', () => {
    expect(normalizeLink('http://a.jedm.cn/a/b/', 'http://b.jedm.cn/c/d/')).to.equal('http://a.jedm.cn/a/b/');
    expect(normalizeLink('https://a.jedm.cn/a/b/', 'https://b.jedm.cn/c/d/')).to.equal('https://a.jedm.cn/a/b/');
  });

  it('标准相对链接', () => {
    expect(normalizeLink('c/d/', 'http://a.jedm.cn/a/b/')).to.equal('http://a.jedm.cn/a/b/c/d/');
    expect(normalizeLink('/c/d/', 'http://a.jedm.cn/a/b/')).to.equal('http://a.jedm.cn/c/d/');
  });

  it('非http和https绝对链接', () => {
    expect(normalizeLink('javascript:void(0)', 'http://a.jedm.cn/a/b/')).to.equal('http://a.jedm.cn/a/b/');
    expect(normalizeLink('data:image', 'http://a.jedm.cn/a/b/')).to.equal('http://a.jedm.cn/a/b/');
  });

  it('去掉hash', () => {
    expect(normalizeLink('/c/d/#abcd', 'http://a.jedm.cn/a/b/')).to.equal('http://a.jedm.cn/c/d/');
    expect(normalizeLink('#abcd', 'http://a.jedm.cn/a/b/')).to.equal('http://a.jedm.cn/a/b/');
    expect(normalizeLink('http://a.jedm.cn/a/b/#abcd', 'http://b.jedm.cn/c/d/')).to.equal('http://a.jedm.cn/a/b/');
  });

  it('保留hash', () => {
    expect(normalizeLink('/c/d/#abcd', 'http://a.jedm.cn/a/b/', false)).to.equal('http://a.jedm.cn/c/d/#abcd');
    expect(normalizeLink('#abcd', 'http://a.jedm.cn/a/b/', false)).to.equal('http://a.jedm.cn/a/b/#abcd');
    expect(normalizeLink('http://a.jedm.cn/a/b/#abcd', 'http://b.jedm.cn/c/d/', false)).to.equal('http://a.jedm.cn/a/b/#abcd');
  });

  it('使用一个参数', () => {
    expect(normalizeLink('http://a.jedm.cn/a/b/')).to.equal('http://a.jedm.cn/a/b/');
    expect(normalizeLink('http://a.jedm.cn/a/b/#abcd')).to.equal('http://a.jedm.cn/a/b/');
    expect(normalizeLink('http://a.jedm.cn/a/b/#abcd', null, false)).to.equal('http://a.jedm.cn/a/b/#abcd');

  });
});

describe('测试 fetchBaseUrl()', () => {
  const { fetchBaseUrl } = huatuo;
  it('有base标签，有base url', () => {
    [
      '<html>\n<base href="http://base.jedm.cn">\n</html>',
      '<html>\n<base href="http://base.jedm.cn" >\n</html>',
      '<html>\n<base href="http://base.jedm.cn" target="_blank">\n</html>',
      '<html>\n<base href="http://base.jedm.cn" target="_blank" >\n</html>',
      '<html>\n<base target="_blank" href="http://base.jedm.cn" >\n</html>',
      '<html>\n<base target="_blank" href="http://base.jedm.cn">\n</html>'
    ].forEach(html => {
      expect(fetchBaseUrl(html)).to.equal('http://base.jedm.cn');
    });
  });

  it('有base标签，无base url', () => {
    expect(fetchBaseUrl('<html>\n<base target="_blank">\n</html>')).to.be.null;
  });

  it('无base标签', () => {
    expect(fetchBaseUrl('<html>\n</html>')).to.be.null;
  });
});

describe('测试 pureHTML()', () => {
  const { pureHTML } = huatuo;
});

describe('测试 parseHTML()', () => {});

describe('测试 checkLinks()', () => {
  const { checkLinks } = huatuo;
  let links;

  before(done => {
    links = [
      buildUrl(),
      buildUrl({ jump: buildUrl() }),
      buildUrl({ statuscode: 404 }),
    ];
    done();
  });

  it('正常测试', () => {
    return checkLinks(links)
      .then(result => {
        expect(result.success.size).to.equal(2);
        expect(result.error.size).to.equal(1);
        expect(result.success.get(links[0])).to.equal('200');
        expect(result.success.get(links[1]).split('|').length).to.equal(2);
        expect(result.success.get(links[1]).startsWith('301=>')).to.be.true;
        expect(result.success.get(links[1]).endsWith('200')).to.be.true;
        expect(result.error.get(links[2])).to.be.instanceof(Error);
      });
  });

  it('传入链接非数组', () => {
    return checkLinks({}, {})
      .then(() => { return Promise.reject('应抛异常') }, () => {});
  });

  it('使用validator', () => {
    return checkLinks(links, {
      validators: [
        (response, success, error) => {
          if (response.redirect.length > 0) {
            error('test');
          }
        },
        (response, success, error) => {
          if (response.statusCode == 404) {
            success();
          }
        },
        (response, success, error) => {
          error('test');
        }
      ]
    }).then(result => {
      expect(result.success.size).to.equal(1);
      expect(result.error.size).to.equal(2);
      expect(result.success.get(links[2])).to.equal('404');
      expect(result.error.get(links[0]).message).to.equal('test');
      expect(result.error.get(links[1]).message).to.equal('test');
    });
  });


});

describe('测试 check()', () => {
  const { check } = huatuo;
  let htmlUrl;

  const assertLinkResult = result => {
    expect(result.get('link').success.size).to.equal(5);
    expect(result.get('link').error.size).to.equal(2);
  };

  before(done => {
    htmlUrl = buildUrl({ file: 'list.html' });
    done();
  });

  it('正常校验', () => {
    return check(htmlUrl, [
      ['link', modules.link],
    ]).then(assertLinkResult);
  });

  it('传对象参数', () => {
    return check(htmlUrl, [
      Object.assign({ name: 'link' }, modules.link),
    ]).then(assertLinkResult);
  });

  it('单一参数数组', () => {
    return check(htmlUrl, ['link', modules.link]).then(assertLinkResult);
  });

  it('单一参数对象', () => {
    return check(htmlUrl, Object.assign({ name: 'link' }, modules.link)).then(assertLinkResult);
  });

  it('自定义模块1', () => {
    return check(buildUrl({ file: 'list.txt' }),
      ['link', { regex: /^.*$/mg }]
    ).then(assertLinkResult);
  });

  it('自定义模块2', () => {
    return check(buildUrl({ file: 'list.json' }),
      ['link', { parser: content => JSON.parse(content).list }]
    ).then(assertLinkResult);
  });

  it('包含base标签', () => {
    return check(buildUrl({ file: 'list2.html' }), [
      ['link', modules.link],
    ]).then(assertLinkResult);
  });

  it('错误参数', () => {
    const assertError = (promise, message) => promise.then(
      () => Promise.reject('应抛异常'),
      e => {
        message && expect(e.message).is.equal(message)
      })
    ;
    return Promise.all([
      assertError(check(htmlUrl, null), 'Module config is incorrect'),
      assertError(check(htmlUrl, 0), 'Module config is incorrect'),
      assertError(check(htmlUrl, true), 'Module config is incorrect'),
      assertError(check(htmlUrl, 'foo'), 'Module config is incorrect'),
      assertError(check(htmlUrl, []), 'Module config is incorrect'),
      assertError(check(htmlUrl, [{}]), 'Module is incorrect'),
      assertError(check(htmlUrl, [['test']]), 'Module is incorrect'),
      assertError(check(htmlUrl, ['test', null]), 'You must set a config Object.'),
      assertError(check(htmlUrl, ['test', { parser: 'parser' }]), 'Parser must be a function!'),
      assertError(check(htmlUrl, ['test', { regex: 'foo' }]), 'Regular expression is incorrect!'),
      assertError(check(htmlUrl, ['test', { regex: [/.*/, null] }]), 'Regular expression group id is incorrect!'),
      assertError(check(htmlUrl, ['test', {}]), 'Module argument is incorrect.'),
      assertError(check(buildUrl({ statuscode: 404 }), ['link', modules.link]), 'Page body is empty, Status Code 404'),
    ]);
  });


});
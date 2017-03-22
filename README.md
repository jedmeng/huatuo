# Huatuo

页面链接校验工具

## 简介

该模块用于对页面中的链接或图片链接进行校验。

## 检测页面

```
huatuo.check(url, modules, [options]);
```
- `url` 待检测页面url
- `modules` 检测模块列表
- `options` 全局配置（可选，优先级低于模块配置）

DEMO：
```
huatuo.check('https://blog.jedm.cn', [
    ['links', huatuo.modules.link],
    ['images', huatuo.modules.image]
]).then(result => {
    console.log('links success:', result.get('links').success);
    console.log('links error:', result.get('links').error);

    console.log('images success:', result.get('images').success);
    console.log('images error:', result.get('images').error);
});
```

## 模块

每个模块为一类链接，通过正则匹配或解析函数得到一组链接列表，例如图片模块，iframe模块等。

### 模块配置
模块的格式为`[模块名, 模块配置]`

支持的模块配置有：
- `regex`: 正则表达式，可以为正则表达式，如需使用正则分组则可以传数组`[正则表达式, 正则分组ID]`
- `parser`: `parser`和`regex`参数需二选一。parser是一个handler函数，接受的参数是页面源码，返回值是链接列表
- `timeout`: 请求的超时时长（默认值：10000）
- `retryTimes`: 遇到链接失败和解析失败时重试次数（默认值：5）
- `followRedirect`: 是否跟随重定向（默认值：true）
- `redirectTimes`: 最大重定向次数（默认值：10）
- `requestMethod`: 请求方式（默认值：HEAD）
- `useFakeHead`: 某些网站没有实现HEAD方法或使用HEAD请求可能得不到正确的结果，此时可以使用fakeHead，
    使用此选项时实际使用GET进行请求，但会在响应头接收完成后断开连接，丢弃响应体的内容。（默认值：true）
- `proxy`: 请求时使用的代理
- `requestAcceptEncoding`: 请求头accept-encoding
- `requestAcceptLanguage`: 请求头accept-language
- `requestAccept`: 请求头accept
- `requestCacheControl`: 请求头cache-control
- `requestConnection`: 请求头connection
- `requestUserAgent`: 请求头user-agent
- `requestReferer`: 请求头referer
- `thread`: 同时发起的连接数（默认值：10）
- `validators`：请求接过校验函数

DEMO:
```
// 定义一个模块，通过正则匹配得到链接，在校验时使用POST方法
['demo1', {
  regex: /^.*$/mg,
  requestMethod: 'POST'
}]

// 定义一个模块，通过解析器得到链接，不跟踪页面重定向
['demo2', {
  parser(content) {
    try {
        const data = JSON.parser(content);
        return data.list;
    } catch(e) {
        return [];
    }
  },
  followRedirect: false
}]
```

### 内置模块
目前内置了三种模块配置，`link`、`image`、`iframe`，可以通过`huatuo.modules.[模块名]`访问

DEMO：
```
// 该模块用于检查页面中的链接
['link', huatuo.modules.link]

// 该模块用于检查页面中的图片，对系统自带的image模块进行了扩展，在请求时携带自定义的referer
['images', Object.assign({}, huatuo.modules.link, {
    requestReferer: 'https://jedm.cn'
})]
```

### 自定义校验器

系统默认根据状态码是否为200判断请求是否成功，如有特殊业务需求可以通过自定义校验器实现。

```
{
    validators: [
        (response, success, error) => {
            // 如果调用success则直接返回成功结果
            // 如果调用error则直接返回错误结果
            // 否则进入下一个校验器进行校验
        },
        (response, success, error) => {
            // 如果最后一个校验器既没有调用success又没有调用error
            // 则会使用默认的校验器，即根据状态码是否为200判断请求是否成功
        }
    ]
}
```

DEMO：
```
// 如果图片体积小于200K即认为失败
['images', Object.assign({}, huatuo.modules.image, {
  requestMethod: 'GET',
  validators: [
    (response, success, error) => {
        if (response.body.length < 200 * 1024) {
            error('图片有误');
        }
    }
  ]
})]

// 对于状态码为521的情况认为请求成功
['links', Object.assign({}, huatuo.modules.link, {
  validators: [
    (response, success, error) => {
        if (response.statusCode == 521) {
            success();
        }
    }
  ]
})]
```

## 返回值

```
huatuo.check('https://jedm.cn, [
  ['link'， huatuo.module.link],
  ['image'， huatuo.module.image]
]}).then(result => {
    // 返回值是一个Map类型，key为模块名，value为结果对象
    const linkResult = result.get('link');

    // 每个结果对象包含success和error两个属性；
    const linkSuccessResult = linkResult.success;
    const linkErrorResult = linkResult.error;

    // 成功结果是一个Map，key为url，value为状态码
    // 经过重定向的结果比较特殊
    // 其value为：状态码=>重定向网址|[状态码=>重定向网址|]重定向后的状态码
    for (let item of linkSuccessResult) {
        console.log(`url: ${item[0]}\tstatus_code: ${item[1]}`);
    }

    // 错误结果也是一个Map，key为url，value为错误信息
    for (let item of linkErrorResult) {
        console.log(`url: ${item[0]}\tmessage: ${item[1]}`);
    }
});
```




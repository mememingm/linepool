# TS 与项目代码复习笔记

整理日期：2026-11-03。目标：能读懂 LinePool 项目里一段代码的用途、输入、输出和执行顺序。

这是前面讲解内容的复习资料。标为“教学例子”的代码用于解释语法；标为“项目代码”的片段来自当前工作区。源码后续可能变化，可通过链接重新定位。

**隔天忘了，先看第 1 节和第 2 节；准备继续看项目，再看第 5 节。其他内容遇到时查。**

## 1. 三分钟找回印象

TypeScript，简称 TS，可以先理解为：在 JavaScript 的基础上，增加描述和检查数据类型的能力。

项目中的 `.ts` 文件使用 TypeScript；`.tsx` 文件还可以包含 React 用来描述界面的 JSX 写法。

| 看到的写法 | 可以先读成什么 |
| --- | --- |
| `const price = 18` | 创建一个名字叫 `price` 的变量，保存数字 `18` |
| `price: number` | 在参数、变量或类型说明中，规定 `price` 应该是数字 |
| `type User = { ... }` | 定义“用户”这种数据应该有什么结构 |
| `user.name` | 读取 `user` 对象的 `name` 字段 |
| `User[]` | 一个数组，里面的每一项都符合 `User` 类型 |
| `getPhoneText(...)` | 调用“获取手机号显示文字”这个函数 |
| `return value` | 把结果交回调用的位置，并结束这次函数调用 |
| `if (...) { ... }` | 条件成立时，执行括号后面的代码块 |
| `phone: string \| null` | `phone` 可以是字符串，也可以是 `null` |
| `phone?: string` | 这个字段或参数可以省略；读取时可能得到 `undefined` |
| `value ?? '备用文字'` | 左边是 `null` 或 `undefined` 时，使用右边的备用值 |
| `configuration = {}` | 在参数位置，没传这个参数或传入 `undefined` 时，默认使用空对象 |
| `export` / `import` | 让一个文件里的内容可以被其他文件使用 / 从其他文件引入内容 |
| `await api.login(input)` | 等待登录调用成功得到结果；失败时会抛出错误 |

**看不懂一整段时，先找三个问题：传进来什么？中间做什么？最后交出去什么？**

## 2. 先把一段完整代码串起来

这是把已经学过的知识合在一起的教学例子：

```ts
type User = {
  name: string;
  phone?: string;
};

function getPhoneText(user: User): string {
  return user.phone ?? '未填写手机号';
}

const currentUser: User = {
  name: '小王',
};

const phoneText = getPhoneText(currentUser);
```

整段的中文意思：

> 先规定用户数据的结构：姓名是必填文字，手机号是可选文字。
>
> 再定义一个函数：接收一个用户，读取他的手机号；没有手机号时，使用“未填写手机号”。
>
> 然后创建一个叫“小王”的用户。
>
> 最后把这个用户传给函数，将得到的显示文字保存下来。

| 名字 | 中文意思 | 在这段里的功能 |
| --- | --- | --- |
| `User` | 用户类型 | 描述用户数据的结构 |
| `getPhoneText` | 获取手机号显示文字 | 根据用户资料，决定返回什么文字 |
| `user` | 用户参数 | 在函数内部接收传进来的用户 |
| `currentUser` | 当前用户 | 保存这次实际创建的用户对象 |
| `phoneText` | 手机号显示文字 | 保存函数返回的结果 |

按执行过程看：

```text
定义 User 类型：描述数据结构
    ↓
定义 getPhoneText 函数：说明调用时要做什么
    ↓
创建 currentUser 对象：{ name: '小王' }
    ↓
执行 getPhoneText(currentUser)
    ↓
这次函数里的 user，指向传进来的 currentUser 对象
    ↓
读取 user.phone，得到 undefined
    ↓
使用备用文字“未填写手机号”
    ↓
return 把这段文字返回，phoneText 保存它
```

**定义函数时，函数体里的操作还没有执行；调用函数时，才进入函数体。** 阅读项目时，要找到实际调用的位置，才能知道这次传了什么。

## 3. 名字、值、类型，分别是什么

### 3.1 名字和值

```ts
const price = 18;
```

- `price`：开发者起的名字，中文是“价格”。
- `18`：实际保存的值。
- `const`：声明变量，之后不能给这个变量重新赋值。

对象可以把有关的数据放在一起：

```ts
const product = {
  name: '示例商品',
  price: 18,
};
```

`product` 是“商品”。`product.price` 就是读取这个商品的价格，结果为 `18`。

注意冒号的上下文：

```ts
const product = { price: 18 }; // 对象里的“字段名：实际值”
type Product = { price: number }; // 类型里的“字段名：允许的类型”
```

同样是 `:`，前一行在写实际数据，后一行在描述数据结构。

### 3.2 类型说明

```ts
type User = {
  name: string;
  points: number;
  active: boolean;
};
```

中文意思：用户应该有姓名、积分、是否启用这三个字段。

| 类型 | 中文意思 | 值的例子 |
| --- | --- | --- |
| `string` | 字符串，可以先理解为文字 | `'小王'`、`'13800138000'` |
| `number` | 数字 | `18`、`3.5` |
| `boolean` | 布尔值，表示是或否 | `true`、`false` |

`type` 只描述结构，不会自动创建用户、查询数据库或检查真实网络数据。它帮助开发工具和编译器检查代码。

类型名如 `User`、`ApiClientConfiguration` 常用大写开头；变量和函数名如 `user`、`createLinepoolApi` 常用小写开头。这是命名习惯。

### 3.3 函数的输入与输出

```ts
function getPointsMessage(points: number): string {
  if (points >= 10) {
    return '积分足够';
  }

  return '积分不足';
}

const message = getPointsMessage(18);
```

- `getPointsMessage`：“获取积分提示”，函数名。
- `points: number`：接收一个数字，函数内部叫它 `points`。
- 括号后面的 `: string`：函数返回文字。
- `message`：“提示信息”，保存实际返回的文字。

```text
传入 18 → points 为 18 → 18 >= 10 成立
       → 返回“积分足够” → message 保存这段文字
```

这里的积分门槛是教学假设，与项目真实业务规则无关。

### 3.4 函数也可以放在对象里

```ts
const tools = {
  getMessage(points: number): string {
    return getPointsMessage(points);
  },
};

const message = tools.getMessage(18);
```

`tools` 是“工具集合”；`getMessage` 是其中一个方法。“方法”在这里就是放在对象里的函数。

这能帮助你理解项目中的 `api.login(input)`：找到 `api` 对象里的 `login` 方法，传入数据并执行。

## 4. 条件、没有值、可选值和默认值

### 4.1 根据条件选择执行路径

```ts
if (points >= 10) {
  return '积分足够';
} else {
  return '积分不足';
}
```

读法：如果条件成立，执行第一块；否则，执行第二块。

| 写法 | 用途 |
| --- | --- |
| `=` | 赋值，例如 `const points = 18` |
| `===` | 严格比较是否相等，例如 `phone === null` |
| `!==` | 严格比较是否不相等 |
| `>=` | 大于或等于 |

执行到 `return`，这次函数调用就结束。所以第 3 节的函数也可以省略 `else`：前面已经返回时，后面那条 `return` 就不会执行。

### 4.2 `null` 和 `undefined`

先通过已经讲过的两个场景来区分：

```ts
const phone: string | null = null;
```

这里主动写下 `null`，表示明确没有手机号。

```ts
function getPhoneText(phone?: string): string {
  return phone ?? '未填写手机号';
}

const text = getPhoneText();
```

这里没有传参数，所以这次函数里的 `phone` 是 `undefined`。

`undefined` 也会出现在读取对象中不存在的字段等情况中。

### 4.3 `|`：类型可以是其中一种

```ts
phone: string | null
```

读法：手机号可以是字符串，也可以是空值。

```ts
type Source = 'mock' | 'live';
```

读法：来源的值只能是 `'mock'` 或 `'live'`。这里是类型里的可选范围，具体能用哪些值要看项目对应的类型或规则。

### 4.4 `?`：允许省略

```ts
type User = {
  name: string;
  phone?: string;
};
```

读法：姓名必须提供，手机号可以省略。读取省略的手机号，会得到 `undefined`。

```ts
function getPhoneText(phone?: string): string {
  return phone ?? '未填写手机号';
}
```

读法：调用函数时，手机号参数也可以省略。

### 4.5 `??`：缺少值时使用备用值

```ts
const phoneText = user.phone ?? '未填写手机号';
```

读法：左边是 `null` 或 `undefined`，使用右边；其他情况保留左边。

| 表达式 | 结果 |
| --- | --- |
| `undefined ?? '备用文字'` | `'备用文字'` |
| `null ?? '备用文字'` | `'备用文字'` |
| `'小王' ?? '备用文字'` | `'小王'` |
| `'' ?? '备用文字'` | `''`，空字符串会保留 |
| `0 ?? 15000` | `0`，数字零也会保留 |

### 4.6 默认参数 `= {}` 与 `??` 处理不同位置

```ts
function readTimeout(configuration: { timeoutMs?: number } = {}): number {
  return configuration.timeoutMs ?? 15000;
}
```

这是便于理解项目的教学函数，名字是“读取超时时间”。

- 参数里的 `= {}`：没传整个配置参数，或传入 `undefined` 时，先使用空对象。
- 函数里的 `?? 15000`：配置里没有超时时间时，再使用 `15000`。
- 默认参数不会在传入 `null` 时自动启用；这个函数的配置参数也没有声明允许 `null`。

```text
readTimeout()
    → 配置使用 {}
    → timeoutMs 为 undefined
    → 返回 15000

readTimeout({ timeoutMs: 10000 })
    → 配置使用传进来的对象
    → timeoutMs 为 10000
    → 返回 10000
```

## 5. 回到真实项目：`api` 是怎么来的

这一节对应上一节课。先看接口调用工具如何创建，再继续追踪登录调用。

### 5.1 两个文件各负责什么

| 文件 | 这次要看的职责 |
| --- | --- |
| [WelcomeLogin.tsx](../../src/linepool/welcome/WelcomeLogin.tsx) | 登录页面，使用接口调用工具处理登录等操作 |
| [client.ts](../../src/linepool/api/client.ts) | 创建接口调用工具，集中提供登录、注册等方法，以及公共请求处理 |

在 `WelcomeLogin.tsx` 中，可以搜索这行：

```ts
const api = createLinepoolApi();
```

中文意思：调用“创建 LinePool 接口调用工具”函数，把返回的对象保存为 `api`。

**创建工具时，先完成配置和函数准备；调用 `api.login(...)` 等方法时，才会发起对应的请求。**

### 5.2 配置类型：`ApiClientConfiguration`

项目代码，来自 `client.ts`：

```ts
export type ApiClientConfiguration = { baseUrl?: string; timeoutMs?: number };
```

| 名字 | 中文意思 | 功能 |
| --- | --- | --- |
| `ApiClientConfiguration` | 接口客户端配置 | 描述创建接口工具时允许传入的配置 |
| `baseUrl` | 基础地址 | 接口请求地址的前缀 |
| `timeoutMs` | 超时时间，单位毫秒 | 接口工具默认采用的请求超时时间 |

两个字段都有 `?`，所以调用者可以只提供其中一个，也可以都不提供。

### 5.3 函数参数与默认超时

在原文件中，函数声明开头是：

```ts
export function createLinepoolApi(configuration: ApiClientConfiguration = {}) {
```

这是原函数的开头片段，后面的函数体在原文件中继续。

中文意思：导出一个函数，接收符合配置类型的参数；没提供参数时，使用空对象。

函数体中还有：

```ts
const timeoutMs = configuration.timeoutMs ?? 15000;
```

中文意思：配置里没有超时时间，就采用 `15000` 毫秒，也就是 15 秒。

把登录页面和这里连起来：

```text
登录页面：createLinepoolApi()
    ↓
没传参数，configuration 使用 {}
    ↓
configuration.timeoutMs 为 undefined
    ↓
timeoutMs 使用 15000，即 15 秒
    ↓
函数继续准备公共请求方法
    ↓
return 返回包含 login、register 等方法的对象
    ↓
登录页面的 api 保存这个对象
```

这里的 15 秒是工具的默认值；源码也允许单次请求提供超时时间。

教学用的自定义调用：

```ts
const api = createLinepoolApi({ timeoutMs: 10000 });
```

这次会采用传入的 10 秒作为工具默认超时。这是演示用法，当前登录页面实际调用没有传这个配置。

### 5.4 `export` 与 `import`：连接不同文件

`export` 是“导出”，让其他文件可以使用这里定义的内容。

登录页面的实际导入语句是：

```ts
import { createLinepoolApi, LinepoolApiError } from '../api/client';
```

`import` 是“导入”。这里从 `../api/client` 引入了创建函数和接口错误类；路径相对于当前登录页面文件。

```text
client.ts 定义并导出函数
    ↓
WelcomeLogin.tsx 导入函数
    ↓
页面执行 createLinepoolApi()
    ↓
拿到 api 对象
    ↓
后续调用 api.login(input)
```

### 5.5 我们接下来从哪里继续

在 `client.ts` 搜索 `login(input`，可以找到：

```ts
login(input: LoginInput, options?: ApiRequestOptions) {
  return request('/auth/login', dataResponseSchema(userSchema), {
    ...options, method: 'POST', body: loginInputSchema.parse(input),
  });
},
```

上面只调整了换行。它是返回对象里的一个方法片段。

现在先辨认这些名字：

| 名字 | 中文意思 | 阅读时先看什么 |
| --- | --- | --- |
| `login` | 登录 | 这个方法负责登录请求 |
| `input` | 输入资料 | 调用者传进来的登录资料 |
| `LoginInput` | 登录输入类型 | 规定资料的结构 |
| `options` | 请求选项 | 可选的请求控制参数 |
| `request` | 发起请求 | 执行公共请求处理 |
| `'/auth/login'` | 登录接口路径 | 与工具的基础地址拼接 |

遇到 `...options`、`dataResponseSchema(...)`、`.parse(...)`，先圈出来，后续沿这条登录流程逐个讲。当前复习先能定位到“页面调用了哪个方法，传给谁，最后走向哪个接口”。

## 6. 前面接触过的其他写法：需要时查

这一节放较早讲过的内容，不要求现在一次记住。

### 6.1 数组、箭头函数、`filter` 和 `map`

```ts
type User = {
  name: string;
  active: boolean;
};

const users: User[] = [
  { name: '小王', active: true },
  { name: '小李', active: false },
];

const names = users
  .filter(user => user.active)
  .map(user => user.name);
```

中文意思：先挑出启用的用户，再把他们的姓名组成一个新数组。结果是 `['小王']`。

- `User[]`：用户数组。
- `user => user.active`：一个简短函数，接收一项用户，返回他的启用状态。
- `filter`：“筛选”，根据条件保留项目。
- `map`：“逐项转换”，把每一项加工成新结果。

读这种连续写法时，沿着结果往下看：用户数组 → 筛出启用用户 → 姓名数组。

### 6.2 `async`、`Promise`、`await`

用登录调用做教学节选：

```ts
const result = await api.login(input);
```

读法：调用登录方法，等待成功结果，再保存为 `result` 并继续后面的代码。

- `async`：声明异步函数；调用后返回一个 Promise。
- `Promise<T>`：最终可能成功得到 `T` 类型结果，也可能失败的异步结果。
- `await`：让当前异步函数在这里等待，不会因此阻塞整个浏览器。
- 如果等待的调用失败，`await` 会抛出错误；可能由当前或外层的错误处理代码接住。

项目里的登录与注册共用一个处理函数，所以真实页面那一行还包含条件选择。它的完整阅读留到后续课程。

### 6.3 日期与时间计算

| 写法 | 中文意思 |
| --- | --- |
| `Date.now()` | 当前时刻的时间戳，单位毫秒 |
| `Date.parse(text)` | 把日期文字解析成毫秒时间戳，解析失败时得到 `NaN` |
| `Math.max(a, b)` | 取两个值里较大的一个 |
| `86400000` | 24 小时对应的毫秒数 |
| `new Date(timestamp).toISOString()` | 把时间戳转换成 ISO 格式的 UTC 时间文字 |

之前看的续期模拟代码，会取“当前时间”和“原到期时间”中较晚的时间，再加上指定天数。模拟选项的计算，与实际续期业务是否开放，需要分别沿代码确认。

### 6.4 `.trim()` 与数据检查

```ts
'  小 王  '.trim()
```

结果是 `'小 王'`：移除开头和结尾的空白，保留中间的空格。

项目里的 schema 可以先理解为“数据检查规则”。TypeScript 类型帮助检查代码如何使用数据，真实请求里的数据还需要运行时检查。具体规则和调用位置，可以继续查看 [接口导读报告](./api-guide.md)。

## 7. 下次打开代码时怎么读

先选一个具体操作，例如“登录”，沿下面这个顺序：

1. **找调用位置。** 页面里调用的是哪个函数或对象方法？
2. **看实际输入。** 括号里传了什么？没有传时有没有默认参数？
3. **跳到定义。** 看参数类型、主要分支和返回的位置。
4. **追结果用途。** 返回结果被保存在哪里，接着用来做什么？
5. **再处理陌生语法。** 先问“这一段起什么作用”，再补解释这段所需的语法。

例如目前这条线：

```text
WelcomeLogin.tsx
    createLinepoolApi()
        ↓
client.ts
    接收配置 → 补默认值 → 返回带接口方法的对象
        ↓
WelcomeLogin.tsx
    api.login(input)
        ↓
client.ts
    login(...) → request(...)
```

**当前已经讲到：创建接口调用工具。下一步：顺着登录方法，理解输入资料怎样交给公共请求函数。**

其他阅读资料：

- [接口导读报告](./api-guide.md)：查接口整体流程和修改位置。
- [接口代码中文注释总目录](./api/README.md)：按功能找对应注释副本。
- [后台契约中文注释副本](./admin.annotated.ts)：查先前 `admin.ts` 中的字段与检查规则。

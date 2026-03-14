---
title: '在 WSL 中提取 Chrome Cookie：从 PyPI 撞名到 App-Bound Encryption'
publishDate: 2026-03-14
description: '想用 boss-cli 在终端刷 BOSS直聘职位，结果踩了一连串坑：PyPI 包撞名、Chrome v127 App-Bound Encryption 加密、反 DevTools 检测、session 不匹配……记录完整排查过程。'
tags:
  - tech
language: '中文'
---

# 在 WSL 中提取 Chrome Cookie：从 PyPI 撞名到 App-Bound Encryption

想在终端里直接刷 BOSS直聘职位，发现有个开源工具 [kabi-boss-cli](https://github.com/jackwener/boss-cli)，于是开始折腾。没想到一个"装个包、登录、搜索"的简单任务，踩了好几个坑。

## 第一坑：PyPI 包撞名

项目 README 写的安装命令是：

```bash
uv tool install boss-cli
```

装完之后 `boss --help` 只有一个 `init` 命令，没有 `login`、`search` 之类的。

原因是 PyPI 上恰好有个完全不相关的项目也叫 `boss-cli`（一个服务器部署工具），而 `jackwener/boss-cli` 根本没有发布到 PyPI。

后来作者把包名改成了 `kabi-boss-cli` 并发布到 PyPI，正确的安装方式：

```bash
uv tool install kabi-boss-cli
```

## 第二坑：QR 登录拿不到 `__zp_stoken__`

安装完之后用 `boss login` 扫码登录，`boss status` 显示已登录（4 个 cookies），但一执行 `boss search`：

```json
{
  "ok": false,
  "error": {
    "code": "not_authenticated",
    "message": "环境异常 (__zp_stoken__ 已过期)。请重新登录: boss logout && boss login"
  }
}
```

反复 `logout && login` 没用。查看 credential 文件：

```json
{
  "cookies": {
    "wt2": "...",
    "wbg": "0",
    "zp_at": "...",
    "bst": "..."
  }
}
```

少了 `__zp_stoken__`。这个 cookie 是 BOSS直聘网页端 JavaScript 动态生成的，APP 扫码登录流程根本不会产生它，只有在浏览器里访问 `zhipin.com` 才会被设置。

## 第三坑：在 WSL 里提取 Chrome Cookie

知道问题所在了：需要从 Windows Chrome 里拿到完整的 cookie，写进 credential 文件。

### 尝试一：browser-cookie3

boss-cli 本身就依赖 `browser-cookie3` 库，所以有 `boss login --cookie-source chrome` 命令。但在 WSL 下，Chrome 是 Windows 应用，cookie 文件在 Windows 路径下，WSL Python 找不到。

换 Windows Python（`D:\Python3\python.exe`）试试：

```bash
/mnt/d/Python3/python.exe -m pip install browser-cookie3
/mnt/d/Python3/python.exe -c "import browser_cookie3 as bc3; print(bc3.chrome(domain_name='.zhipin.com'))"
```

报错：

```
browser_cookie3.BrowserCookieError: Unable to get key for cookie decryption
```

原因是 Chrome v127 引入了 **App-Bound Encryption**，cookie 加密不再只依赖 DPAPI，而是绑定到 Chrome 进程本身，第三方程序（包括 browser-cookie3）无法解密。

### 尝试二：直接读 SQLite 文件

Chrome cookie 存在 SQLite 数据库里：

```
C:\Users\<用户名>\AppData\Local\Google\Chrome\User Data\Default\Network\Cookies
```

Chrome 运行时文件被锁，关掉 Chrome 用 PowerShell 复制后，用 sqlite3 查询：

```bash
sqlite3 /mnt/c/Temp/chrome_cookies.db \
  "SELECT name, is_httponly, expires_utc FROM cookies WHERE host_key LIKE '%zhipin%'"
```

可以看到 cookie 名字和元信息（包括 `__zp_stoken__` 存在、未过期、非 HttpOnly），但值是加密的，依旧无法解密。

### 尝试三：Bookmarklet（部分成功）

`__zp_stoken__` 不是 HttpOnly，JavaScript 可以读取。BOSS直聘会检测 F12 开发者工具导致页面崩溃，但书签里的 JavaScript 不受限制：

```
javascript:void(prompt("cookies",JSON.stringify(Object.fromEntries(document.cookie.split(";").map(c=>[c.trim().split("=")[0],c.trim().split("=").slice(1).join("=")])))))
```

拿到了 `__zp_stoken__` 等非 HttpOnly cookie。但写入 credential 文件后仍然报错。

### 关键发现：Session 不匹配

排查发现，**QR 登录的 `wt2`/`zp_at` 和浏览器的 `__zp_stoken__` 属于不同 session**，服务器会验证它们是否匹配。混用两套 session 的 cookie 会被拒绝。

用 curl 直接测试也确认了这一点：

```bash
curl -s "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=Python" \
  --cookie "wt2=<QR登录的值>; __zp_stoken__=<浏览器的值>"
# 返回 code=37, "您的环境存在异常"
```

所以必须**从同一个浏览器 session 中同时获取所有 cookie**，包括 HttpOnly 的 `wt2` 和 `zp_at`。

### 尝试四：Playwright（失败）

试图用 Playwright 挂载 Chrome 现有 profile 提取 cookie：

- 使用默认 profile → Chrome 报错 "DevTools remote debugging requires a non-default data directory"
- 使用临时 profile → 触发 BOSS直聘反自动化检测

### 尝试五：Chrome 远程调试端口（失败）

```bash
powershell.exe -Command "Start-Process chrome.exe -ArgumentList '--remote-debugging-port=9222'"
```

WSL2 的 `localhost` 不通 Windows，用 Windows IP 也无响应——Chrome 在已有用户数据目录的情况下会复用现有实例，忽略调试端口参数。

### 最终方案：EditThisCookie 扩展

Chrome 内置的 Cookie-Editor 扩展只导出了非 HttpOnly cookie，**缺少关键的 `wt2`、`zp_at`**。

换用 **EditThisCookie** 扩展后，成功导出了所有 cookie（包括 HttpOnly），拿到了来自同一 session 的完整 cookie 集合：

```json
{
  "wt2": "...(HttpOnly)",
  "zp_at": "...(HttpOnly)",
  "wbg": "0(HttpOnly)",
  "bst": "...",
  "__zp_stoken__": "...",
  "__a": "...",
  "__c": "...",
  ...
}
```

将所有 cookie 写入 `~/.config/boss-cli/credential.json`，**`boss search` 终于成功返回职位列表**。

## 总结

| 坑 | 原因 | 解法 |
|---|---|---|
| 安装了错误的包 | PyPI 有同名不同包 | `uv tool install kabi-boss-cli` |
| `__zp_stoken__` 缺失 | QR 登录不经过网页端 JS | 从浏览器提取 |
| browser-cookie3 失败 | Chrome v127 App-Bound Encryption | 放弃，改用扩展 |
| Bookmarklet 拿到 cookie 但不能用 | `wt2`/`zp_at`（HttpOnly）和 `__zp_stoken__` 来自不同 session | 必须从同一 session 提取全部 cookie |
| Cookie-Editor 扩展不完整 | 未导出 HttpOnly cookie | 换用 EditThisCookie |
| Playwright / CDP 失败 | 反自动化检测 + WSL2 网络隔离 | 放弃 |

### 正确流程（WSL + Chrome）

1. 在 Chrome 中登录 `zhipin.com`
2. 安装 **EditThisCookie** 扩展
3. 在 zhipin.com 页面点击 EditThisCookie 图标，导出所有 cookie
4. URL 解码 `__zp_stoken__` 等含 `%xx` 的值
5. 写入 `~/.config/boss-cli/credential.json`
6. `boss search` 正常工作

**注意**：`__zp_stoken__` 有过期时间（通常几天），过期后需要重新用 EditThisCookie 提取一次。

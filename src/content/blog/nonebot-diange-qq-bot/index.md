---
title: '用 NoneBot2 + NapCat 做一个 QQ 点歌机器人'
publishDate: 2026-03-18
description: '从零搭建一个 QQ 点歌 bot：私聊发 #歌名 就能收到音乐卡片。记录 NapCat 部署、双源搜索、自发消息路由等实际踩过的坑。'
tags:
  - tech
language: '中文'
---

# 用 NoneBot2 + NapCat 做一个 QQ 点歌机器人

想在 QQ 里用歌代替文字——发 `#我爱你`，对方收到一张《我爱你》的音乐卡片。听起来很简单，实际做下来踩了不少坑。

## 整体架构

```
用户发送: #我爱你
       │
       ▼
┌──────────────┐   OneBot v11 WS   ┌──────────────────┐
│  NapCat      │ ◄────────────────► │    NoneBot2      │
│  (QQ 协议端)  │                    │  plugins/        │
└──────────────┘                    │  └─ music_search │
                                    └──────────────────┘
                                           │
                                    ┌──────┴──────┐
                                    ▼             ▼
                              网易云音乐API   QQ音乐API
```

NapCat 负责 QQ 登录和收发消息，NoneBot2 负责业务逻辑，两者通过 WebSocket 通信。搜索优先走网易云，搜不到 fallback 到 QQ 音乐。

## 部署 NapCat

NapCat 是基于 NTQQ 的第三方 QQ 协议端，支持 Docker 部署。WSL2 下直接跑：

```bash
docker run -d --name napcat \
  -p 3001:3001 -p 6099:6099 \
  mlikiowa/napcat-docker:latest
```

国内 Docker Hub 被墙，用 DaoCloud 镜像：

```bash
docker run -d --name napcat \
  -p 3001:3001 -p 6099:6099 \
  m.daocloud.io/docker.io/mlikiowa/napcat-docker:latest
```

启动后访问 `http://127.0.0.1:6099/webui`，token 在日志里：

```bash
docker logs napcat | grep token
```

扫码登录后，在 NapCat 配置里需要改两个东西：

1. WebSocket 监听端口设为 3001
2. `reportSelfMessage: true` —— 后面处理 bot 自发消息要用

**注意：NapCat 和桌面版 QQ 不能同时登录同一个号。** 测试时得用手机 QQ 或另一个号。

## NoneBot2 项目搭建

```bash
python -m venv .venv
source .venv/bin/activate
pip install nonebot2[fastapi,websockets] nonebot-adapter-onebot httpx
```

`bot.py` 就几行：

```python
import nonebot
from nonebot.adapters.onebot.v11 import Adapter

nonebot.init()
driver = nonebot.get_driver()
driver.register_adapter(Adapter)
nonebot.load_plugins("plugins")

if __name__ == "__main__":
    nonebot.run()
```

`.env` 配置：

```env
DRIVER=~fastapi+~websockets
HOST=127.0.0.1
PORT=8080
COMMAND_START=["#"]
ONEBOT_WS_URLS=["ws://127.0.0.1:3001"]
```

## 搜索逻辑

### 网易云音乐 API

用的是网易云非官方的搜索接口：

```python
async with httpx.AsyncClient(timeout=10) as client:
    response = await client.post(
        "https://music.163.com/api/search/get",
        data={"s": keyword, "type": 1, "limit": 20, "offset": 0},
        headers={"Referer": "https://music.163.com"},
    )
```

`Referer` 头必须带，不然返回 403。

### 模糊匹配

搜索结果往往不是精确匹配，比如搜"我爱你"，返回的可能是"我爱你中国"、"我爱你不是因为你美丽"之类的。用 `difflib.SequenceMatcher` 做模糊匹配：

```python
from difflib import SequenceMatcher

scored = [
    (song, SequenceMatcher(None, keyword, song["name"]).ratio())
    for song in songs
]
scored.sort(key=lambda x: x[1], reverse=True)
```

阈值设 0.4——低于这个分数认为没有匹配，但还是会把最接近的结果作为 fallback 返回。

### QQ 音乐 fallback

网易云搜不到的话，再试 QQ 音乐：

```python
async with httpx.AsyncClient(timeout=10) as client:
    response = await client.get(
        "https://c.y.qq.com/soso/fcgi-bin/client_search_cp",
        params={"w": keyword, "p": 1, "n": 20, "format": "json", "t": 0},
        headers={"Referer": "https://y.qq.com"},
    )
```

两个源都搜完后，取分数最高的那个结果。

## 踩坑记录

### 坑 1：音乐卡片格式

OneBot v11 的音乐卡片有两种格式：

- **简写格式**：`type: "163"` + `id`，让协议端自己去拉歌曲信息
- **自定义格式**：`type: "custom"` + 完整的 url/audio/title/content/image

一开始用了简写格式，结果 NapCat 直接报错：

```
ActionFailed: 消息体无法解析, 请检查是否发送了不支持的消息类型
```

NapCat 不支持简写格式的音乐卡片解析。改成 custom 格式，手动提供所有字段就好了：

```python
MessageSegment(
    type="music",
    data={
        "type": "custom",
        "url": f"https://music.163.com/song?id={song_id}",
        "audio": f"https://music.163.com/song/media/outer/url?id={song_id}.mp3",
        "title": song_name,
        "content": artist_name,
        "image": pic_url,
    },
)
```

### 坑 2：bot 自发消息不被识别

需求是 bot 自己在聊天窗口输入 `#歌名` 也能触发。NapCat 上报自发消息的 `post_type` 是 `message_sent`，但 NoneBot2 只认 `message`。

解决方案是自定义 Event 类，覆盖 `get_type()` 返回 `"message"`：

```python
class SelfSentMessageEvent(MessageEvent):
    post_type: Literal["message_sent"]

    def get_type(self) -> str:
        return "message"

class SelfSentPrivateMessageEvent(SelfSentMessageEvent):
    message_type: Literal["private"]
    target_id: int = 0

Adapter.add_custom_model(SelfSentPrivateMessageEvent)
```

`Adapter.add_custom_model()` 的参数必须是 Event 子类，不能传字符串——它通过 Literal 类型注解自动推断匹配规则。

### 坑 3：自发消息发回给了自己

`bot.send(event, message)` 对自发消息会发回给 bot 自己，因为 `user_id == self_id`。得判断事件类型，用 `target_id` 发给实际的聊天对方：

```python
async def _send(bot, event, message):
    if isinstance(event, SelfSentPrivateMessageEvent) and event.target_id:
        await bot.send_private_msg(user_id=event.target_id, message=message)
    else:
        await bot.send(event, message)
```

### 坑 4：网易云 album.picUrl 经常为空

搜索结果里 `album.picUrl` 不一定有值，但 `album.picId` 通常有。可以用 picId 拼封面 URL：

```python
pic_url = album.get("picUrl") or ""
if not pic_url:
    pic_id = album.get("picId")
    if pic_id:
        pic_url = f"https://p1.music.126.net/{pic_id}/{pic_id}.jpg"
```

不过用了 custom 卡片格式后，封面字段对 QQ 客户端的渲染影响不大，空着也能正常显示。

## 仅响应私聊

handler 里加个 isinstance 检查就行：

```python
@song_cmd.handle()
async def handle_song(bot: Bot, event: MessageEvent):
    if not isinstance(event, (PrivateMessageEvent, SelfSentPrivateMessageEvent)):
        return
    # ...
```

## 最终效果

私聊 bot 发 `#我爱你`，收到一张可以直接播放的音乐卡片。bot 自己在聊天窗口发也能触发。

项目代码：[GitHub - nonebot-diange](https://github.com/stoicneko/nonebot-diange)

## 总结

整个项目的核心逻辑不复杂——搜索 API + 模糊匹配 + 构造卡片消息。大部分时间花在了 NapCat 的部署和各种边界情况（自发消息、卡片格式、封面 URL）上。

几个经验：

- NapCat 的 custom 音乐卡片比简写格式可靠得多
- NoneBot2 的自定义 Event 机制很灵活，但文档不太够，得看源码
- 非官方 API 随时可能变，做好降级方案（双源 fallback）比较稳妥
- 第三方 QQ 协议端有封号风险，建议用小号

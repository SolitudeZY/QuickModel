# Android 0.1.0 个人试用版

## 0.4.0 语音通话（2026-09-28）

- 聊天页的“语音通话”按钮打开独立通话界面；文字记录可展开，沿用当前服务器会话、模型、健康上下文与附件。
- 模型产生完整句段后，服务器调用百炼实时语音合成并逐包转发 24 kHz PCM；Android 用 AudioTrack 边接收边播放，句段按序排队。打断立即停止当前播放并清空旧句段。服务端 `/voice/tts-stream` 需设备鉴权，厂商密钥仍只在服务器。
- 前台通话使用 AudioRecord 和 Android 回声消除检测说话；说话会停止 AI 声音、取消当前生成，静音后自动识别并开启下一轮。也可轻点“立即说话”手动打断。退出或切后台释放麦克风；首次使用按需授权。实际回声消除与自动打断阈值需在小米 14 真机调校。
- 保留原 `/voice/asr` 与 `/voice/tts`，0.3 客户端可继续使用。覆盖安装 `QuickModel-0.4.0.apk`，versionCode 4，同签名，设备配对凭据保留。

设计与验收范围见 [`docs/mobile-voice-call-0.4-plan.md`](../docs/mobile-voice-call-0.4-plan.md)。

## 0.2.0 更新（2026-09-27）

- 原生 FrameLayout 统一处理状态栏、挖孔、导航栏和 IME；不再把 padding 直接加给 WebView。Android 11+ 使用 WindowInsetsAnimation 按帧调整安全区域，并消费已处理的 insets，避免网页重复避让。网页使用真实可用视口高度，键盘出现时隐藏底部导航。
- `shared-background.js` 从桌面 `starfield.js` 原样复制，复用城市、星光、星轨与天气效果、raindrop-fx；手机页面独立提供配色和可读性遮罩。浏览器窗口缩小测试不能替代小米真机键盘动画验证。
- 新增 `/settings` GET/POST：共享外观、天气、默认模型、最大输出、思考模式；模型名称及系统提示词可编辑。修改带 revision 校验，仍加密保存在 models.enc，保留已有密钥与厂商协议。设置不包含 API 密钥或服务地址；更换服务商仍通过电脑导入。
- 新增 `/weather`：自动来源为经过本机 Apache 代理得到的客户端 IP，绝不使用服务器出口 IP；支持手动城市，ipwho.is 定位 + Open-Meteo 天气。最多短期内存缓存，不落盘位置历史；失败时显示未读取成功，不伪造实时晴天。
- 本次导入桌面已有的常用外观/思考设置，并按用户要求启用动态背景、自动天气及手机 IP 地区。后续设置以服务器保存值为准，不重复覆盖。
- 仍未做桌面与手机之间的持续双向配置同步，桌面技能、记忆、工具和附件不等于已经同步。
- 覆盖安装 `QuickModel-0.2.0.apk`，versionCode 2，同签名；保留设备登录，无需再次配对。

技术依据：[Android WebView insets](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)、[键盘动画](https://developer.android.com/develop/ui/views/layout/sw-keyboard)、[Open-Meteo](https://open-meteo.com/en/docs)。

以下为 0.1.0 基础部署记录；功能边界以本节更新为准。

本阶段：Kotlin WebView 壳 + FastAPI/SQLite。复用桌面 `create_model_adapter`、marked/KaTeX/highlight 与 Markdown 数学渲染函数；手机界面单独适配触屏。

## 当前功能与边界

- 文字聊天、7 个现有模型、服务器持久化、停止生成、断网重连、发送请求去重。
- 104 条桌面历史一次性导入，只读；原桌面文件未改动。完整双向自动同步未实现。
- 最近 7 天步数、心率、睡眠；无记录不显示成零。服务器每 2 小时同步小米云端；手环仍须先经过小米运动健康上传。可手动触发同步。
- 0.3 可开启健康上下文、图片/截图理解、短视频抽帧与分段语音；健康分享默认关闭，不做实时诊断/报警。桌面工具、技能和跨端记忆尚未接入。
- 手机按需申请麦克风与系统截屏授权；无需 Health Connect、小米开发者账号或广泛存储权限。

## 服务与数据

- API：`https://47.102.146.139/quickmodel-api/`，Apache 代理到 `127.0.0.1:18324`。保留现有 `/dav/`。
- 服务：`quickmodel-mobile.service`；代码 `/opt/quickmodel-mobile`；独立 Python venv `/opt/quickmodel-mobile-venv`。
- 数据：`/var/lib/quickmodel-mobile/mobile.db`；模型配置 `models.enc` 使用 `/etc/quickmodel-mobile/vault.key` 加密。SQLite 本身未加密，以服务账户权限保护。
- 手机设备 token 只在 Android Keystore 加密存储中；最近 15 个已读取的模型/会话响应加密缓存。健康面板不离线缓存；用户开启健康聊天后，已发送的健康快照随会话一起加密缓存。账号 token 不进入网页 JS。
- 配对码经 SSH 生成、24 小时有效、一次使用；公网配对接口有尝试次数限制。所有业务接口需要 Bearer token，数据库只保存 token 哈希。
- 健康后台：`quickmodel-health-sync.timer`，每偶数小时的 15 分附近运行；`journalctl -u quickmodel-health-sync.service` 查看结果。

首次部署：打包 `mobile_server/`、`app/{__init__,config,multimodal,model_protocol}.py`、根 `requirements.txt` 到 `/opt/quickmodel-mobile`，执行 `sh mobile_server/deploy.sh`。模型 JSON 经 SSH stdin 传给 `python -m mobile_server.admin models`，不要写入仓库或 shell 参数。代理发布脚本 `publish_proxy.py` 会备份 Apache 配置并检查语法后 reload。定时同步 unit 需安装到 `/etc/systemd/system` 后 enable timer。

生成设备配对码（服务器上）：

```sh
cd /opt/quickmodel-mobile
runuser -u qmmobile -- /opt/quickmodel-mobile-venv/bin/python -m mobile_server.admin pair
```

模型更新仍需 SSH 导入。`admin import` 从 stdin 接受 `[{id: 文件名stem, body: 原始JSON}]`，跳过临时会话，已有 ID 不覆盖。历史字段保留，但导入时服务端更新时间为导入时间。

## 构建与测试

设置 `JAVA_HOME` 为 JDK 21，`ANDROID_HOME` 指向含 Android 35 / build-tools 35.0.0 的 SDK。运行：

```powershell
python mobile_server/prepare_assets.py
cd android
.\gradlew.bat assembleRelease
```

输出 `android/app/build/outputs/apk/release/app-release.apk`。最低 Android 9，目标 Android 15，可在 Android 16 运行。试用包复用本机自动生成的个人 debug 签名密钥，但 release 包不启用调试；请保存 `%USERPROFILE%/.android/debug.keystore` 以便覆盖更新，密钥不提交。

依赖版本：AGP 8.9.2、Kotlin 2.1.20、Gradle 8.11.1、AndroidX WebKit 1.12.1；DOMPurify 3.4.16 npm 发布包经 SHA-512 integrity 校验后 vendoring，附许可证。其余 vendor 从桌面复制；更新桌面渲染后运行 prepare_assets。

验证：

- `python -m unittest discover -s tests -p test_mobile_server.py -v`：鉴权、密钥不返回、一次性配对、撤销设备、版本冲突、历史只读、适配器选择、重复请求、生成持久化。
- `node tests/mobile_frontend.cjs`：Playwright/Edge 的 393px 页面测试，配对、聊天、健康空记录、Markdown/数学、恶意 HTML 与横向溢出。`QM_PLAYWRIGHT` 可指定 Playwright Node 包绝对路径。
- `python mobile_server/smoke.py`：临时配对设备，验证公网 HTTPS、真实模型回复与健康接口，再撤销测试设备；会创建一条标记的联调会话。
- 编译与签名检查通过后交付 APK；本机当前无连接的 Android 真机，安装、系统键盘和 HyperOS WebView 表现需在用户小米 14 上验收。

未实现设备管理 UI；撤销令牌需 SQLite 运维或手机“断开此设备”。服务器快照备份/恢复演练和长期稳定性观察仍待完善。


## 0.3 多模态配置与验证

`admin multimodal` 从 SSH stdin 接收 `{vision: {api_key, base_url, model}, speech: {api_key, asr_url, tts_url, asr_model, tts_model, voice}}`，更新加密配置并保留现有模型/设置/设备令牌。不要把含密钥 JSON 放入仓库、命令参数或日志。新增 Pillow 依赖从根 requirements.txt 提取。

`python mobile_server/smoke_multimodal.py` 使用合成色块和短句检查图片、模型、TTS/ASR；留下标记的测试会话，结束撤销临时测试设备。系统服务重启后先等待 HTTP 就绪，`systemctl active` 不等于监听端口已完成初始化。

附件保存在 `/var/lib/quickmodel-mobile/media`，需要设备鉴权；数据库只保存 ID/文本快照，不保存编码。服务器备份需一并包含 media、数据库、加密配置与独立保存的解密密钥。目前尚未提供附件清理界面。

完整实现状态、限制及真机验收清单见 `docs/mobile-multimodal-agent-plan.md`。语音不是双工；退出前台会停止录音。视频是稀疏抽帧，不能保证捕获快速动作。

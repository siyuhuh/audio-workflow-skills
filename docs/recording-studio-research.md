# VocalFlow Recording Studio 调研与方案

> 调研日期：2026-08-01  
> 结论：值得新增一个顶层 **录音 / Recordings** 页面，但它应该定位为轻量录音棚，而不是把 Room 内现有录音弹层原样搬过去，也不应该扩张成完整 DAW。

## 1. 推荐结论

新增顶层导航：

`Home / Add / Room / Recordings`

其中职责保持清楚：

- **Room**：沉浸式演唱、歌词、MV、倒数和快速开始/停止录音。
- **Recordings**：统一管理所有歌曲的 take，查看波形，A/B 试听，校准人声延迟，调整人声/伴奏比例，重命名、导出和删除。
- **New take**：在 Recordings 中选择歌曲后进入一个更技术化的录音 session；第一版可以复用 Room 的播放与录音引擎，保存后自动回到 Recordings 的详情页。

这会比现在把录音、take 列表和混音控制全部塞在 Stage 工具浮层里更合理。Stage 可以继续保持 lyrics-first；录完以后，用户有一个真正能找到作品、比较版本和完成导出的地方。

## 2. 当前项目已经具备什么

当前 Electron 版并不是从零开始：

- `KaraokeRoomScene.tsx` 已包含 `MediaRecorder` 采集、3 秒倒数、设备信息、自动随歌曲结束停止、take 列表、试听、重命名、删除和 mix 参数。
- `main.ts` 已能把浏览器录音转为 WAV，并用 FFmpeg 渲染 WAV/M4A/MP3 混音。
- `RecordingMixSettings` 已有 `vocalGain`、`musicGain`、`vocalOffsetMs`、原唱/伴奏选择和导出格式。
- `listRecordings(sourceSongPackageId?)` 不传歌曲 ID 时已经可以返回全局录音列表。
- 文件与 metadata 已统一保存在 `~/Music/VocalFlow/Recordings` 和 `recording.json`。

所以新增页面主要是 **information architecture、可视化和状态复用**，不需要重做录音后端。

当前最需要处理的技术债是：录音 session 状态和 UI 都集中在 `KaraokeRoomScene.tsx`。做新页面前应提取共享的 `useRecordingSession`（或等价 controller），避免 Room 和 Recordings 各维护一套 `MediaRecorder`、倒数、保存和错误状态。

## 3. 开源工具调研

| 项目 | 定位与可参考点 | 对 VocalFlow 的启发 | 不建议照搬 |
| --- | --- | --- | --- |
| [Loukai](https://github.com/monteslu/loukai) | 与 VocalFlow 技术栈和场景最接近：React + Vite + Electron；Web Audio 实时处理；PA/IEM 双路输出；per-stem gain、routing、effects；AudioWorklet 低延迟处理 | 将麦克风、伴奏和原唱当作明确的 audio routes；设备/监听状态应该是一等信息；以后可加入 monitor preset | 多输出、实时 Auto-Tune 和完整 KJ mixer 不应进入第一版 |
| [Nightingale](https://github.com/rzru/nightingale) | 本地 K 歌库、实时 pitch scoring、mic monitoring、gain、beep-based latency test、key/tempo controls | 延迟校准应按设备保存；“测试麦克风/延迟”应该从隐藏高级参数升级为明确的 setup 动作 | 评分、profile、游戏化与本次录音页不是同一目标 |
| [WakkaQt](https://github.com/guprobr/WakkaQt) / [项目说明](https://gu.pro.br/wakkaqt/) | 专门录制“人声 + karaoke playback”，用 FFmpeg 生成成品；包含 webcam、波形和自动 vocal mastering | 与当前 VocalFlow 的 FFmpeg 后处理路线相符；可参考 vocal polish 的分阶段概念：noise reduction、compression、limiter | 自动 pitch correction 风险高，容易改变用户演唱；先不要默认开启 |
| [Ardour](https://github.com/Ardour/ardour) / [Manual](https://manual.ardour.org/ardourmanual.html) | 专业 DAW；用 playlists 管理多次 takes；区分 input/disk monitoring；明确 latency compensation、punch in/out、layered recording | 同一首歌下的 take 应作为一个 session 比较；原始人声永不覆盖；所有 mix 都是非破坏参数 | 不复制多轨 routing、插件链、复杂 timeline 和 DAW 术语密度 |
| [Audacity](https://github.com/audacity/audacity) / [Recording preferences](https://manual.audacityteam.org/man/recording_preferences.html) | 录音 meter、overdub、latency correction、punch-and-roll；官方建议录音 peak 约为 -6 dB，且提醒 software monitoring 的延迟 | 录前要有输入 meter、clipping 提示、耳机提示；延迟校准必须可见且可恢复默认值 | 不需要提供任意剪切、粘贴、效果插件和传统工具栏 |
| [AudioMass](https://github.com/pkalogiros/AudioMass) | 浏览器波形编辑器；支持 multitrack、armed channel recording、clip drag、crossfade 和 bounce | 证明 Electron/Web 技术栈足以做可靠的轻量波形工作台 | 不直接引入整套 editor；代码结构和交互范围都重于本项目需求 |
| [WaveSurfer.js](https://github.com/katspaugh/wavesurfer.js) | BSD-3-Clause 的 TypeScript waveform library；官方提供 Record、Timeline、Regions、Minimap、Envelope 插件 | 适合快速实现 waveform、playhead、hover time 和 loop/region；许可与当前 AGPL 项目兼容 | 它是播放/可视化库，不负责真正的音频剪切和效果处理；不要把它误当 DAW engine |
| [UltraStar Deluxe](https://github.com/UltraStar-Deluxe/USDX) | 成熟开源 K 歌游戏，以 microphone pitch/rhythm scoring 和多人演唱为核心 | 说明演唱界面应继续保持娱乐和即时反馈，录音制作能力应放到独立工作台 | 不要让 Recordings 页变成评分页或第二个 Room |

最直接可参考的组合是：

1. **Loukai**：audio routes、monitoring 和 Electron/Web Audio 架构。
2. **Ardour**：session / take 的心智模型和非破坏编辑。
3. **Audacity**：录前 meter、clipping 与 latency setup。
4. **WaveSurfer.js**：Electron renderer 内的波形与时间轴实现。

## 4. 页面信息架构

建议页面名使用 **Recordings / 录音**。页面内部把专业概念叫 **Take**，避免顶层导航使用过于专业的 “Studio” 让普通用户误以为必须懂 DAW。

### 4.1 默认：全局录音库

```text
┌ Recordings ─────────────────────────── [New take] [Open folder] ┐
│ [Search song or take]   [All songs] [Recent] [Needs attention] │
├───────────────────────────────┬─────────────────────────────────┤
│ Song / session list           │ Selected take                   │
│                               │                                 │
│ Let It Be          3 takes    │ Let It Be — Take 03             │
│ 2 minutes ago      Best: 03   │  ┌───────────────────────────┐  │
│                               │  │ Vocal waveform             │  │
│ Yesterday Once...  1 take     │  ├───────────────────────────┤  │
│ Yesterday          02:48      │  │ Music / mix waveform       │  │
│                               │  └───────────────────────────┘  │
│ ...                           │  ◀︎  ▶︎  01:23 / 03:41   A/B     │
│                               │                                 │
│                               │  Vocal  0.92   Music  0.78      │
│                               │  Sync   +86 ms  Backing ✓       │
│                               │  WAV / M4A / MP3                │
│                               │  [Save mix] [Export] [•••]      │
└───────────────────────────────┴─────────────────────────────────┘
```

关键点：

- 左侧按 `sourceSongPackageId` 聚合为 session；同一首歌的多个录音不应该散成无关联文件。
- 右侧默认展示最新 take，可快速切换 take 01/02/03。
- 波形只承担定位、对齐和试听，不在第一版承担任意剪辑。
- 调整 gain/offset 时即时预听；只有按 **Save mix / Export** 时调用 FFmpeg 渲染文件。
- destructive action（删除）继续放入单独确认的 overflow menu。

### 4.2 New take：录音 session

录音页里的 New take 流程：

1. 选择已有 karaoke package。
2. 显示 microphone、sample rate、monitoring、input level 和 latency preset。
3. 做 3 秒 count-in，播放 backing/original 并录制 raw vocal。
4. 保存 raw vocal 后立即进入 selected take 详情。

第一版可直接把用户带到 Room，并增加 `recording-ready` 入口状态；第二版再把共享 playback/recording controller 放入 Recordings 的专注 session surface。这样能先交付新页面，同时避免短期复制整套歌词和播放同步代码。

## 5. “稍微专业”的功能边界

专业感主要来自 **可靠性和信息清晰度**，不是按钮数量。

### P0：新页面第一版

- 全局列出录音，按歌曲聚合并支持搜索、日期排序。
- 选中 take 后提供 waveform、scrub、播放/暂停、duration。
- 现有 rename、delete、reveal in Finder、WAV/M4A/MP3 export。
- 现有 vocal/music gain、backing/original、`vocalOffsetMs`。
- `Record new take` 与 `Sing again`，保存后自动打开新 take。
- 空状态、文件丢失状态、FFmpeg 渲染失败状态。

### P1：真正提升录音质量的功能

- 录前 input meter：peak、clip hold、过低提示；目标区间建议显示为约 `-12 dBFS` 到 `-6 dBFS`，但不自动改变系统输入增益。
- 麦克风 setup：device、channel、sample rate、耳机/monitoring 提示。
- 每个 device 保存 latency preset，并提供 beep-based automatic test。
- 波形双轨显示：raw vocal 与 backing/mix 共用 playhead。
- 即时 non-destructive preview graph，再由 FFmpeg 固化 export。
- 质量摘要：peak、clipping count、integrated loudness（LUFS）和 true peak；先展示，不自动“修好”。

### P2：可选 vocal polish

- Noise reduction、high-pass、compressor、de-esser、limiter 组成少量 preset，例如 `Natural / Clear / Strong`。
- 所有效果默认非破坏，可 A/B，可随时回到 raw vocal。
- Punch in/out 或局部重唱可以后置；它会显著增加 timeline、crossfade 和数据模型复杂度。

### 明确不做

- 第一版不做 VST/AU plugin host。
- 不做任意 clip cut/paste、多轨编曲或 automation lane。
- 不默认开启 Auto-Tune。
- 不把评分、pitch game 和录音后期混在同一页。
- 不覆盖 raw vocal；任何 mix 都是派生 export。

## 6. 技术落地建议

### 6.1 Renderer 结构

```text
App.tsx
├─ RecordingStudioScene.tsx
│  ├─ RecordingSessionList.tsx
│  ├─ RecordingTakeTimeline.tsx
│  ├─ RecordingTransport.tsx
│  ├─ RecordingInspector.tsx
│  └─ RecordingSetupSheet.tsx
├─ KaraokeRoomScene.tsx
└─ hooks/useRecordingSession.ts
```

- `AppNavTarget` 增加 `"recordings"`。
- `workspaceMode` 最好逐步替换为明确的 route/scene state；若暂时不重构，可先加第四个值。
- `useRecordingSession` 统一封装 microphone acquire、countdown、MediaRecorder、stop/save、device metadata、cleanup 和 error mapping。
- Room 只保留紧凑的 record transport 和最近一次结果入口；完整 library 从 Room 移到 Recordings。

### 6.2 Waveform

推荐先采用 WaveSurfer.js，并只使用：

- waveform + progress/playhead；
- Timeline；
- Hover；
- Regions（以后做 loop 或 punch range 时再启用）。

3–5 分钟音频可以先在 renderer decode。若双轨或长文件出现内存问题，使用主进程预计算 peak buckets 并缓存到 recording package；WaveSurfer 官方也建议大文件使用 pre-decoded peaks。项目已有 FFmpeg，因此可以先写一个小型 peak extractor，而不额外捆绑大型工具。

### 6.3 即时混音预听

当前 `updateRecordingMix` 每次都会通过 FFmpeg 重新渲染，适合保存，不适合拖动 slider 时实时反馈。

建议增加 renderer-side preview graph：

```text
source music ── GainNode ─┐
                          ├─ preview output
raw vocal ─── GainNode ───┘
              + time offset
```

- 两个 media source 共用 transport clock。
- slider 只更新 `GainNode`。
- `vocalOffsetMs` 更新 vocal 起始/seek 对齐。
- **Save mix** 才调用现有 `updateRecordingMix`，确保导出可复现。

### 6.4 数据模型

第一版不需要迁移磁盘格式。Renderer 可先把多个 `RecordingPackage` 按 `sourceSongPackageId` 分组为 `RecordingSessionViewModel`。

长期建议让一个 session 真正包含多个 takes：

```ts
interface RecordingSession {
  id: string;
  sourceSongPackageId: string;
  title: string;
  takes: RecordingTake[];
  activeTakeId: string | null;
  mix: RecordingMixSettings;
  exports: RecordingExport[];
}
```

当前 schema 已有 `takes: RecordingTake[]`，但保存逻辑实际上每次创建一个新的 `RecordingPackage` 和一个 take。先在 UI 聚合可以零迁移交付；真正支持 comp/punch 前再做 schema v2。

### 6.5 音频质量分析

主进程可以用现有 FFmpeg 在保存后异步生成：

- peak / clipping count；
- RMS 或 LUFS-I；
- true peak；
- silence ratio。

分析结果应作为 metadata 缓存，不阻塞 raw vocal 落盘。录音最重要的可靠性规则是：**先保存原始文件，再做转换、分析和 mix render**。

## 7. 推荐实施顺序

1. **MVP / 中等改动**：新增 Recordings 顶层页；全局列表按歌曲聚合；复用现有试听/rename/mix/export API；Room 保存后可跳转详情。
2. **Professional pass / 中等偏大**：共享 `useRecordingSession`、双轨 waveform、Web Audio 即时混音、device meter 与 latency setup。
3. **Quality pass / 大改动**：LUFS/peak 分析、vocal presets、自动延迟测试、session schema v2。
4. **Advanced / 独立项目**：punch/comp、多段 take、pitch visualization 或评分。

最合理的下一步不是先加入音频效果，而是先做 MVP 页面和共享录音 controller。它能立即解决“录音藏得深、跨歌曲找不到、后期空间太小”的产品问题，同时为后续专业能力建立正确结构。

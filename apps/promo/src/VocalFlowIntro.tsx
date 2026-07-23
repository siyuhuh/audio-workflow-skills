import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BrandFrame } from "./components/BrandFrame";
import { FeatureCard, MockUiCard, PipelineStep } from "./components/FeatureCard";
import { LogoMark } from "./components/LogoMark";
import { MonoBadge, SceneTitle } from "./components/SceneTitle";
import { fonts, tokens } from "./tokens";

function IntroScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const taglineEnter = spring({ frame: frame - 20, fps, config: { damping: 18, stiffness: 90 } });

  return (
    <BrandFrame>
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36 }}>
        <LogoMark size={240} />
        <div style={{ textAlign: "center", opacity: taglineEnter, transform: `translateY(${interpolate(taglineEnter, [0, 1], [24, 0])}px)` }}>
          <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.03em" }}>VocalFlow Studio</div>
          <div style={{ fontSize: 30, color: tokens.foregroundMuted, marginTop: 12 }}>
            从链接到练歌素材，一条本地工作流
          </div>
        </div>
      </AbsoluteFill>
    </BrandFrame>
  );
}

function ProblemScene() {
  return (
    <BrandFrame>
      <AbsoluteFill style={{ padding: "120px 140px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 56 }}>
        <SceneTitle
          eyebrow="痛点"
          title="练歌和字幕，不该拆成四五个工具"
          subtitle="下载、分离、转写、格式转换——VocalFlow 把它们收成一次操作。"
          align="left"
        />
        <div style={{ display: "flex", gap: 24 }}>
          <FeatureCard index={0} icon="⬇️" title="下载媒体" detail="YouTube / Bilibili / 本地文件" />
          <FeatureCard index={1} icon="🎙️" title="人声分离" detail="可选 UVR 级 stem 输出" />
          <FeatureCard index={2} icon="📝" title="歌词转写" detail="平台字幕优先，本地 Whisper 兜底" />
          <FeatureCard index={3} icon="📦" title="一键打包" detail="LRC · SRT · VTT · JSON · stems" />
        </div>
      </AbsoluteFill>
    </BrandFrame>
  );
}

function CaptureScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cursorBlink = Math.floor(frame / 15) % 2 === 0 ? 1 : 0;
  const typed = "https://www.bilibili.com/video/BV...";
  const chars = Math.min(typed.length, Math.floor(interpolate(frame, [10, 70], [0, typed.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));

  const goEnter = spring({ frame: frame - 80, fps, config: { damping: 14, stiffness: 120 } });

  return (
    <BrandFrame>
      <AbsoluteFill style={{ padding: "100px 140px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
        <SceneTitle
          eyebrow="Capture"
          title="粘贴链接，或拖入文件"
          subtitle="支持媒体 URL、本地音视频，以及已有 UVR 人声 stem。"
          align="left"
        />
        <MockUiCard title="VocalFlow Studio">
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div
              style={{
                border: `1px solid ${tokens.rule}`,
                borderRadius: 12,
                padding: "22px 24px",
                fontFamily: fonts.mono,
                fontSize: 22,
                background: tokens.white,
                minHeight: 32,
              }}
            >
              {typed.slice(0, chars)}
              <span style={{ opacity: cursorBlink, color: tokens.primary }}>|</span>
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div
                style={{
                  background: tokens.primary,
                  color: tokens.white,
                  padding: "16px 36px",
                  fontSize: 22,
                  fontWeight: 600,
                  transform: `scale(${goEnter})`,
                  opacity: goEnter,
                }}
              >
                GO
              </div>
              <MonoBadge label="separate · MP3 · auto" />
            </div>
          </div>
        </MockUiCard>
      </AbsoluteFill>
    </BrandFrame>
  );
}

function PipelineScene() {
  const frame = useCurrentFrame();
  const activeIndex = Math.min(4, Math.floor(interpolate(frame, [0, 120], [0, 4.99], { extrapolateRight: "clamp" })));

  const steps = ["检测输入", "平台字幕", "人声分离", "Whisper 转写", "导出素材包"];

  return (
    <BrandFrame>
      <AbsoluteFill style={{ padding: "100px 140px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 72 }}>
        <SceneTitle
          eyebrow="Process"
          title="智能管线，自动选最快路径"
          subtitle="有平台字幕就先转换；没有就下载音频、分离人声，再本地转写。"
          align="left"
        />
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          {steps.map((label, i) => (
            <PipelineStep key={label} index={i} label={label} active={i <= activeIndex} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {["yt-dlp", "ffmpeg", "audio-separator", "whisper"].map((tool, i) => (
            <MonoBadge key={tool} label={tool} />
          ))}
        </div>
      </AbsoluteFill>
    </BrandFrame>
  );
}

function OutputsScene() {
  const outputs = [
    { ext: ".lrc", desc: "同步歌词 · 练歌" },
    { ext: ".srt", desc: "剪映 / PR / Resolve" },
    { ext: ".vtt", desc: "网页播放器" },
    { ext: ".json", desc: "自动化 / Agent" },
    { ext: "stems/", desc: "人声 + 伴奏" },
  ];

  return (
    <BrandFrame>
      <AbsoluteFill style={{ padding: "100px 140px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
        <SceneTitle
          eyebrow="Review"
          title="一次任务，多种可用输出"
          subtitle="歌词校对、字幕导出、stem 进 DAW——同一套时间轴数据。"
          align="left"
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {outputs.map((item, i) => (
            <OutputRow key={item.ext} index={i} ext={item.ext} desc={item.desc} />
          ))}
        </div>
      </AbsoluteFill>
    </BrandFrame>
  );
}

function OutputRow({ index, ext, desc }: { index: number; ext: string; desc: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - index * 6, fps, config: { damping: 16, stiffness: 110 } });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "18px 24px",
        background: tokens.sageCard,
        border: `1px solid ${tokens.rule}`,
        borderRadius: 14,
        transform: `translateX(${interpolate(enter, [0, 1], [40, 0])}px)`,
        opacity: enter,
      }}
    >
      <span style={{ fontFamily: fonts.mono, fontSize: 26, fontWeight: 600, color: tokens.primary, minWidth: 120 }}>{ext}</span>
      <span style={{ fontSize: 24, color: tokens.foregroundMuted }}>{desc}</span>
    </div>
  );
}

function RoomScene() {
  const frame = useCurrentFrame();
  const lineProgress = interpolate(frame, [20, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lyric = "把任何一首歌，变成可以开唱的素材";
  const activeChars = Math.floor(lyric.length * lineProgress);

  return (
    <BrandFrame variant="room">
      <AbsoluteFill style={{ padding: "100px 140px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 64 }}>
        <SceneTitle
          eyebrow="Room"
          title="卡拉 OK 练习室"
          subtitle="同步歌词滚动、伴奏播放、歌单排队——从文件生成到真正开唱。"
          align="left"
          dark
        />
        <div
          style={{
            alignSelf: "center",
            width: "100%",
            maxWidth: 1100,
            background: tokens.roomPanel,
            borderRadius: 28,
            padding: "56px 64px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 52, fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.02em" }}>
            <span style={{ color: tokens.sageAccent }}>{lyric.slice(0, activeChars)}</span>
            <span style={{ color: "rgba(245,247,242,0.28)" }}>{lyric.slice(activeChars)}</span>
          </div>
          <div
            style={{
              marginTop: 40,
              height: 4,
              background: "rgba(245,247,242,0.12)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div style={{ width: `${lineProgress * 100}%`, height: "100%", background: tokens.primary }} />
          </div>
        </div>
      </AbsoluteFill>
    </BrandFrame>
  );
}

function LocalFirstScene() {
  return (
    <BrandFrame>
      <AbsoluteFill style={{ padding: "100px 140px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
        <SceneTitle
          eyebrow="Local-first"
          title="本地处理，CLI 同源"
          subtitle="桌面 App 编排同一套 audio-subtitles 管线。不上传媒体，不绑账号。"
          align="left"
        />
        <MockUiCard title="Terminal">
          <pre
            style={{
              margin: 0,
              fontFamily: fonts.mono,
              fontSize: 20,
              lineHeight: 1.7,
              color: tokens.foreground,
              whiteSpace: "pre-wrap",
            }}
          >
            {`$ audio-subtitles --separate \\\n    --separator-format MP3 \\\n    "https://youtube.com/watch?v=..."\n\n→ stems/vocals.mp3\n→ stems/instrumental.mp3\n→ lyrics.lrc · subtitles.srt`}
          </pre>
        </MockUiCard>
      </AbsoluteFill>
    </BrandFrame>
  );
}

function CtaScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 10, fps, config: { damping: 16, stiffness: 100 } });

  return (
    <BrandFrame>
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40 }}>
        <LogoMark size={160} animate={false} />
        <div style={{ textAlign: "center", opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [20, 0])}px)` }}>
          <div style={{ fontSize: 56, fontWeight: 600, marginBottom: 16 }}>准备好开唱了吗？</div>
          <div style={{ fontSize: 28, color: tokens.foregroundMuted, marginBottom: 36 }}>
            macOS · Windows · 免费下载
          </div>
          <div
            style={{
              display: "inline-block",
              background: tokens.primary,
              color: tokens.white,
              padding: "20px 48px",
              fontSize: 26,
              fontWeight: 600,
            }}
          >
            github.com/siyuhuh/audio-workflow-skills
          </div>
        </div>
      </AbsoluteFill>
    </BrandFrame>
  );
}

export function VocalFlowIntro() {
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={90} premountFor={30}>
        <IntroScene />
      </Sequence>
      <Sequence from={90} durationInFrames={120} premountFor={30}>
        <ProblemScene />
      </Sequence>
      <Sequence from={210} durationInFrames={150} premountFor={30}>
        <CaptureScene />
      </Sequence>
      <Sequence from={360} durationInFrames={150} premountFor={30}>
        <PipelineScene />
      </Sequence>
      <Sequence from={510} durationInFrames={150} premountFor={30}>
        <OutputsScene />
      </Sequence>
      <Sequence from={660} durationInFrames={150} premountFor={30}>
        <RoomScene />
      </Sequence>
      <Sequence from={810} durationInFrames={150} premountFor={30}>
        <LocalFirstScene />
      </Sequence>
      <Sequence from={960} durationInFrames={390} premountFor={30}>
        <CtaScene />
      </Sequence>
    </AbsoluteFill>
  );
}

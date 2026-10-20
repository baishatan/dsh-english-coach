/* eslint-disable */
window.__ModuleLoader__.load({
  id: '@lijingtong/dsh-english-coach',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    // ------------------------------------------------------------------ i18n

    // The plugin speaks Chinese. English only appears inside the learning
    // material itself, so there is no language switch: following the app
    // locale once flipped the whole panel to English for a Chinese learner.
    const TEXT = {
      title: '英语教练',
      today: '今日',
      plan: '计划',
      progress: '进度',
      loading: '加载中…',
      retry: '重试',
      onboardTitle: '先说三件事',
      onboardHint: '这些只影响每天给你找什么材料，随时可以改。',
      goal: '想用英语做什么',
      goalWork: '工作里用',
      goalStudy: '读书 / 研究',
      goalTravel: '旅行 / 生活',
      goalMedia: '看剧、播客、新闻',
      goalExam: '准备考试',
      goalOther: '说不好',
      minutes: '每天能挤出多久',
      targetBand: '想练到哪一档',
      interests: '感兴趣的主题',
      interestsHint: '逗号分隔，例如：工程管理, 产品设计, 能源',
      workContext: '我们猜你在做',
      workContextHint: '按当前工作区猜的，不对就改。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      startAssessment: '先做一次测评',
      assessmentFirst: '测评大约 10 分钟，全是选择题。',
      needBank: '还没有题库。点下面让 Agent 出一套，大约一分钟。',
      makeBank: '生成测评题库',
      makeBankRunning: '正在出题…',
      bankReady: '题库已就绪，可以开始测评。',
      fullAssessment: '开始测评（20 题）',
      shortAssessment: '短测（10 题）',
      question: '第 {n} / {total} 题',
      resultTitle: '你的档位',
      resultRef: '参照',
      resultWeak: '薄弱环节',
      resultWeakNone: '这次没有明显的薄弱项。',
      finish: '知道了',
      exiting: '退出',
      generateToday: '生成今天',
      generating: '正在找素材、加工…',
      generateFailed: '生成失败',
      draft: '草稿',
      active: '进行中',
      done: '已完成',
      expired: '已过期',
      startLesson: '开始这一课',
      noLesson: '今天还没有课。点上面生成一课，或明天再说，草稿不会催你。',
      noLessonHint: '生成后会先存成草稿，你点开始才算开始。',
      draftReady: '今天的课已经生成好了，点开始才算开始。',
      expiredHint: '这一课没开始就过期了，不会再计入进度。',
      itemReading: '阅读',
      itemListening: '听力',
      itemExpressions: '表达',
      itemQuiz: '测验',
      itemOrdering: '排序',
      finishItem: '完成这一项',
      itemDone: '已完成',
      source: '原文',
      fetchedAt: '抓取于',
      license: '许可',
      play: '播放',
      pause: '暂停',
      replay: '重听',
      noSpeech: '这台设备没有可用的语音合成，先读文稿。',
      correct: '答对了',
      wrong: '答错了',
      orderHint: '按顺序点词，组成一句话。',
      orderCheck: '检查',
      orderReset: '重来',
      yourAnswer: '你的答案',
      correctOrder: '正确顺序',
      planTitle: '学习路线',
      weekGoals: '本周目标',
      weekEmpty: '这一周还没有目标。',
      noSyllabus: '还没有大纲。做完测评后会自动生成一份；也可以在设置里让 Agent 重写。',
      progressTitle: '进度',
      bestStreak: '最长 {n} 天',
      curve: '水平曲线',
      noCurve: '至少两次测评后才有曲线。',
      driftNote: '难度提示',
      diagnostics: '诊断数据',
      accuracy: '答对率',
      expiredDrafts: '过期草稿',
      dueReview: '到期复习',
      collapse: '收起',
      dragHint: '按住可以拖到别处，点一下打开',
      dataRoot: '数据目录',
      dataRootHint: '所有数据都是这个目录里的 JSON 文件，可以备份、可以拷走。',
      migrate: '迁移到…',
      migrating: '迁移中…',
      automation: '每日自动生成',
      automationHint: '默认关闭。开启后每天到点由 Agent 生成一份草稿。',
      automationTime: '生成时间',
      audioProvider: '音频来源',
      audioWeb: '系统语音合成（默认，无需密钥）',
      audioSource: '素材自带音频（尚未实现，会回落到系统语音）',
      enabled: '开启',
      disabled: '关闭',
      automationOn: '已开启',
      automationOff: '未开启',
      band: '档位',
      editProfile: '编辑画像',
      regenerateSyllabus: '重新生成大纲',

      // workbench
      words: '单词',
      todayLesson: '今天的课',
      remainingItems: '还剩 {n} 项 · 约 {min} 分钟',
      remainingShort: '约 {min} 分钟',
      regenerate: '重新生成',
      sourceNote: '素材说明',
      lessonCards: '课上的卡片',
      continueLesson: '继续 · {type} {min} 分钟',
      dueShort: '待复习',
      streakShort: '连续',
      bandShort: '档位',
      assessmentShort: '测评',
      assessmentFirstHint: '做完会给出档位和薄弱项，之后的大纲照着排。',
      backToStudy: '回到今天',
      todayIndex: '今天 {done} / {total} 项',
      noLessonShort: '今天还没排课',
      streakAndMastered: '连续 {streak} 天 · 已掌握 {mastered} 个',
      viewProgress: '看进度',
      phaseIndex: '第 {n} / {total} 阶段',
      nowWhere: '现在在哪',
      routeTitle: '换路线',
      routeNote: '大纲照着当前档位排，不写死日期；水平变了就重写一次。本周已勾选的目标会保留。',
      rewriteRoute: '重写大纲',

      // review
      pickMeaning: '选一个最接近的意思',
      nextWord: '下一个',
      finishReview: '完成复习',
      reviewDone: '今天的词过完了',
      reviewDoneHint: '答对 {n} 个。明天这时候会再见到它们，答对的会推得更远。',
      wordKind: '单词',
      expressionKind: '表达',
      kbdPick: '按 1–4 直接选',
      kbdHint: '按 1–4 选择 · ↵ 继续',
      nothingDue: '今天没有到期的词',
      nothingDueShort: '暂无到期',
      nothingDueHint: '到期的词会在这里出现。',
      nextDue: '下次 {date} · {n} 个',
      nextDueShort: '下次 {date}',
      dueToday: '今天到期 {n} 个',
      openPanel: '在面板里打开',
      openLibrary: '去词库',
      studyInPanel: '在面板里复习',
      pillHint: '这里只是入口：完整的复习、讲解和词库都在面板里。',

      // library
      library: '词库',
      libraryAll: '全部',
      libraryLearning: '在学',
      libraryMastered: '已掌握',
      libraryEmpty: '这一类还没有词。',
      libraryHint: '每答对一次往后走一格；1 / 7 / 30 天都答对算掌握。',
      dueTodayShort: '今天',
      tomorrow: '明天',
      daysAfter: '{n} 天后',

      // progress
      completedDays: '完成天数',
      streakDays: '连续天数',
      masteredWords: '已掌握',
      learningWords: '在学',
      missedCount: '错 {n}',

      // cards + word detail
      tapAnswer: '点开答案',
      newWord: '新词',
      nextReview: '下次复习',
      attemptsLabel: '作答',
      attemptsValue: '{n} 次 · 错 {wrong}',

      // pace + continue learning
      studyPace: '学习节奏',
      wordsPerDay: '每天学几个词',
      wordsPerDayHint: '3 到 30 个。课程按这个数出词，补充学习也按这个数。',
      continueLearning: '继续学习',
      continueLearningHint: '再来 {n} 个新词，大约一分钟',
      generatingWords: '正在出词…',
      generatingWordsHint: '正在出词，大约一分钟；出好后会自动接着学。',
      continueReview: '继续复习剩下的 {n} 个',
      continueHint: '想多学几个，去面板点「继续学习」。',
      nextDueContinue: '下次 {date}。想多学几个，去面板点「继续学习」。',
      vocabEmpty: '这次没有拿到新词，再点一次试试。'
    }

    function t(key, vars) {
      let text = TEXT[key] ?? key
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(value))
        }
      }
      return text
    }

    // ------------------------------------------------------------------- rpc

    const API = '/english-coach/api'
    const PILL_POSITION_KEY = 'english-coach:pill-position'
    // The overlay can only open the panel; when a deck is already mounted it can
    // also ask it to start a vocabulary job, so the pill's button does what it says.
    const vocabRequests = new Set()

    async function call(command, payload) {
      let response
      try {
        response = await fetch(`${API}/${command}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {})
        })
      } catch (error) {
        return { ok: false, code: 'network', message: `连不上插件后台：${error.message ?? error}` }
      }
      if (!response.ok) {
        const hint = response.status === 404 ? '，插件后台还没就绪，刷新页面重试' : ''
        return {
          ok: false,
          code: `http_${response.status}`,
          message: `插件后台返回 ${response.status}${hint}（${command}）`
        }
      }
      try {
        return await response.json()
      } catch {
        return { ok: false, code: 'bad_response', message: '插件后台返回了无法解析的内容' }
      }
    }

    // --------------------------------------------------------------- audio

    /**
     * AudioProvider: turn English text into sound. The first implementation is
     * the browser's own speech synthesis — every platform, no key, works
     * offline. Adding a provider that plays audio attached to the source, or
     * calls an external speech service, means adding one entry here; callers
     * keep calling `audioProvider(id).speak(text)`.
     */
    const AUDIO_PROVIDERS = {
      'web-speech': {
        id: 'web-speech',
        available() {
          return typeof window !== 'undefined' && 'speechSynthesis' in window
        },
        speak(text, handlers) {
          if (!this.available()) return false
          const synth = window.speechSynthesis
          synth.cancel()
          const utterance = new window.SpeechSynthesisUtterance(text)
          utterance.lang = 'en-US'
          utterance.rate = 0.92
          if (handlers && handlers.onEnd) utterance.onend = handlers.onEnd
          if (handlers && handlers.onError) utterance.onerror = handlers.onError
          synth.speak(utterance)
          return true
        },
        pause() {
          if (this.available()) window.speechSynthesis.pause()
        },
        resume() {
          if (this.available()) window.speechSynthesis.resume()
        },
        stop() {
          if (this.available()) window.speechSynthesis.cancel()
        }
      }
    }

    function audioProvider(id) {
      return AUDIO_PROVIDERS[id] ?? AUDIO_PROVIDERS['web-speech']
    }

    // ----------------------------------------------------------------- style

    const CSS = `
.ec-root { height: 100%; overflow: auto; color: var(--dsw-alias-label-primary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", sans-serif;
  font-size: 13.5px; line-height: 1.62; }
.ec-wrap { max-width: 1060px; margin: 0 auto; padding: 26px 30px 96px; }

/* ------------------------------------------------------------------ top bar */
.ec-top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.ec-top h1 { font-size: 17px; font-weight: 600; margin: 0; letter-spacing: -.01em; }
.ec-seg { display: inline-flex; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px; padding: 2px; }
.ec-seg button { border: 0; background: none; padding: 5px 12px; border-radius: 7px; font: inherit; font-size: 12.3px;
  color: var(--dsw-alias-label-secondary); cursor: pointer; }
.ec-seg button[data-on="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 2px rgba(0,0,0,.07); }
.ec-status { margin-left: auto; display: flex; align-items: center; gap: 14px; font-size: 12px;
  color: var(--dsw-alias-label-secondary); }
.ec-status b { color: var(--dsw-alias-label-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
.ec-status button { border: 0; background: none; padding: 0; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); text-decoration: underline; text-underline-offset: 3px; }
.ec-status button:hover { color: var(--dsw-alias-brand-primary); }

/* ---------------------------------------------------------------- structure */
.ec-grid { display: grid; grid-template-columns: minmax(0, 1fr) 336px; gap: 16px; align-items: start; }
.ec-col > * + * { margin-top: 14px; }
.ec-page > .ec-card + .ec-card { margin-top: 14px; }
@media (max-width: 920px) { .ec-grid { grid-template-columns: 1fr; } }

.ec-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px; padding: 18px 20px; }
.ec-card + .ec-card { margin-top: 14px; }
.ec-card h2 { font-size: 14.5px; font-weight: 600; margin: 0; letter-spacing: -.01em; }
.ec-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.ec-card-head .ec-sub { margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums; }
.ec-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ec-muted { color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.65; }
.ec-empty { color: var(--dsw-alias-label-secondary); font-size: 13px; padding: 18px 0; text-align: center; }
.ec-hair { height: 1px; background: var(--dsw-alias-border-l1); border: 0; margin: 14px 0; }

/* ----------------------------------------------------------------- controls */
.ec-btn { font: inherit; font-size: 12.8px; border-radius: 8px; padding: 7px 13px; cursor: pointer;
  border: 1px solid transparent; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  transition: background .12s ease, border-color .12s ease, opacity .12s ease; }
.ec-btn:hover:not(:disabled) { background: var(--dsw-alias-border-l1); }
.ec-btn:disabled { opacity: .45; cursor: default; }
.ec-btn-primary { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.ec-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.06); }
.ec-btn-ghost { background: transparent; border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.ec-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.ec-btn-sm { padding: 5px 10px; font-size: 12px; }
.ec-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ec-field { margin-bottom: 14px; }
.ec-label { display: block; font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; }
.ec-input, .ec-select { font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary); width: 100%; box-sizing: border-box; }
.ec-badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l1); white-space: nowrap; }
.ec-badge[data-tone="draft"] { color: var(--dsw-alias-state-warn-primary); }
.ec-badge[data-tone="done"] { color: var(--dsw-alias-state-success-primary); }
.ec-badge[data-tone="expired"] { color: var(--dsw-alias-state-idle-primary); }
.ec-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary); font-size: 11.5px; white-space: nowrap; }
.ec-chip-brand { color: var(--dsw-alias-brand-primary); border-color: transparent;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); }
.ec-chip-ok { color: var(--dsw-alias-state-success-primary); border-color: transparent;
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
.ec-dots { display: inline-flex; gap: 3px; align-items: center; }
.ec-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-border-l2); }
.ec-dots i[data-on="true"] { background: var(--dsw-alias-brand-primary); }
.ec-en { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", serif; }
.ec-ring { width: 52px; height: 52px; border-radius: 50%; flex: none; display: grid; place-items: center;
  background: conic-gradient(var(--dsw-alias-brand-primary) calc(var(--p, 0) * 1%), var(--dsw-alias-border-l1) 0); }
.ec-ring > span { width: 40px; height: 40px; border-radius: 50%; background: var(--dsw-alias-bg-layer-1);
  display: grid; place-items: center; font-size: 11.5px; color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums; }
.ec-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.ec-stat b { display: block; font-size: 22px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.ec-stat span { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }

/* ------------------------------------------------------------------- lesson */
.ec-lesson-title { font-size: 16px; font-weight: 600; letter-spacing: -.01em; line-height: 1.45; margin-top: 6px; }
.ec-lesson-sum { margin-top: 5px; color: var(--dsw-alias-label-secondary); font-size: 12.8px; }
.ec-items { margin-top: 12px; }
.ec-li { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto 18px; gap: 12px; align-items: center;
  width: 100%; padding: 9px 0; border: 0; border-top: 1px solid var(--dsw-alias-border-l1);
  background: none; text-align: left; cursor: pointer; color: inherit; font: inherit; }
.ec-li:first-child { border-top: 0; }
.ec-li .ec-type { font-size: 10.5px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 2px 0; text-align: center; letter-spacing: .02em; }
.ec-li .ec-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-li .ec-min { font-size: 11.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.ec-li .ec-check { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2);
  display: grid; place-items: center; font-size: 10px; color: transparent; }
.ec-li[data-done="true"] .ec-name { color: var(--dsw-alias-label-secondary); }
.ec-li[data-done="true"] .ec-check { border-color: var(--dsw-alias-state-success-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
  color: var(--dsw-alias-state-success-primary); }
.ec-li[data-open="true"] .ec-name { color: var(--dsw-alias-brand-primary); }
.ec-item-body { padding: 2px 0 18px; }
.ec-item-body .ec-muted + .ec-body { margin-top: 8px; }
.ec-body { font-size: 15px; line-height: 1.85; color: var(--dsw-alias-label-primary); white-space: pre-wrap;
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", serif; }
.ec-transcript { font-size: 14.5px; line-height: 1.8; white-space: pre-wrap;
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", serif; }
.ec-choices { display: grid; gap: 8px; margin: 10px 0; }
.ec-choice { display: flex; align-items: center; gap: 10px; text-align: left; width: 100%; font: inherit;
  font-size: 13.2px; line-height: 1.45; padding: 9px 11px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); cursor: pointer;
  transition: border-color .12s ease, background .12s ease, opacity .12s ease; }
.ec-choice:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.ec-choice .ec-key { width: 19px; height: 19px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); display: grid;
  place-items: center; font-size: 10.5px; flex: none; font-variant-numeric: tabular-nums; }
.ec-choice[data-state="right"] { border-color: var(--dsw-alias-state-success-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.ec-choice[data-state="right"] .ec-key { background: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-bg-base); }
.ec-choice[data-state="wrong"] { border-color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.ec-choice[data-state="wrong"] .ec-key { background: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-bg-base); }
.ec-choice[data-state="dim"] { opacity: .5; }
.ec-choice:disabled { cursor: default; }
.ec-feedback { font-size: 12.8px; line-height: 1.7; margin-top: 8px; padding: 9px 11px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.ec-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.ec-word { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ec-word[data-used="true"] { opacity: .35; }
.ec-progress { height: 3px; border-radius: 2px; background: var(--dsw-alias-border-l1); overflow: hidden; margin: 8px 0 14px; }
.ec-progress > i { display: block; height: 100%; background: var(--dsw-alias-brand-primary); }

/* --------------------------------------------------------------------- deck */
.ec-deck-term { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", serif;
  font-size: 33px; line-height: 1.22; letter-spacing: -.015em; }
.ec-deck[data-compact="true"] .ec-deck-term { font-size: 25px; }
.ec-deck-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.ec-deck-prompt { margin: 14px 0 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ec-fb { margin-top: 13px; padding-top: 12px; border-top: 1px dashed var(--dsw-alias-border-l1); }
.ec-fb .ec-verdict { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-state-success-primary); }
.ec-fb[data-tone="err"] .ec-verdict { color: var(--dsw-alias-state-error-primary); }
.ec-fb .ec-meaning { font-size: 14px; margin-top: 3px; }
.ec-fb .ec-example { margin-top: 6px; font-size: 14px; color: var(--dsw-alias-label-secondary);
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
.ec-fb .ec-note { margin-top: 7px; font-size: 12.3px; color: var(--dsw-alias-label-secondary);
  padding-left: 9px; border-left: 2px solid var(--dsw-alias-border-l1); }
.ec-fb .ec-acts { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.ec-kbd { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: .8; }
.ec-done-card { text-align: center; padding: 26px 20px 22px; }
.ec-done-mark { width: 42px; height: 42px; border-radius: 50%; margin: 0 auto 12px; display: grid; place-items: center;
  font-size: 18px; color: var(--dsw-alias-state-success-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
.ec-done-card h2 { font-size: 16px; }
.ec-done-card .ec-acts { display: flex; gap: 8px; justify-content: center; margin-top: 16px; }

/* --------------------------------------------------------------- flash card */
.ec-flash { display: block; width: 100%; text-align: left; border: 0; border-top: 1px dashed var(--dsw-alias-border-l1);
  background: none; padding: 8px 0; cursor: pointer; font: inherit; color: inherit; }
.ec-flash:first-of-type { border-top: 0; }
.ec-flash-front { font-size: 14px; line-height: 1.45;
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
.ec-flash-hint { margin-top: 2px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); opacity: .8; }
.ec-flash-back { margin-top: 4px; font-size: 13.5px; }
.ec-flash-back .ec-muted { margin-top: 3px; }

/* ------------------------------------------------------------------ modal */
.ec-modal-back { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, .32);
  display: flex; align-items: center; justify-content: center; padding: 24px; }
.ec-modal { width: min(440px, 100%); max-height: calc(100vh - 80px); overflow: auto;
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 16px; padding: 18px 20px 20px; box-shadow: 0 24px 80px rgba(0, 0, 0, .32); }
.ec-modal-head { display: flex; align-items: center; gap: 8px; }
.ec-modal-head .ec-btn { margin-left: auto; }
.ec-modal-term { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  font-size: 30px; line-height: 1.25; letter-spacing: -.015em; margin-top: 12px; }
.ec-modal-meaning { font-size: 15px; margin-top: 8px; }
.ec-modal .ec-note { margin-top: 8px; font-size: 12.5px; color: var(--dsw-alias-label-secondary);
  padding-left: 9px; border-left: 2px solid var(--dsw-alias-border-l1); }
.ec-kv { display: grid; grid-template-columns: 68px minmax(0, 1fr); gap: 7px 12px; margin: 16px 0 0;
  padding-top: 14px; border-top: 1px dashed var(--dsw-alias-border-l1); font-size: 12.5px; }
.ec-kv dt { color: var(--dsw-alias-label-secondary); }
.ec-kv dd { margin: 0; color: var(--dsw-alias-label-primary); }

/* ------------------------------------------------------------------ library */
.ec-lib-filter { display: flex; gap: 6px; margin: 10px 0 4px; }
.ec-lib-filter button { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary); border-radius: 999px; padding: 3px 10px; font: inherit;
  font-size: 11.5px; cursor: pointer; }
.ec-lib-filter button[data-on="true"] { background: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1); }
.ec-lib-list { margin-top: 4px; }
.ec-lib-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 0;
  border: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: none; text-align: left;
  font: inherit; color: inherit; cursor: pointer; }
.ec-lib-row:hover .ec-lib-term { color: var(--dsw-alias-brand-primary); }
.ec-lib-row:first-child { border-top: 0; }
.ec-lib-term { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", serif;
  font-size: 14px; flex: 0 1 auto; min-width: 0; max-width: 62%; line-height: 1.35; }
.ec-lib-row .ec-when { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums; white-space: nowrap; }

/* --------------------------------------------------------------------- plan */
.ec-timeline { display: grid; }
.ec-step { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 12px; padding: 12px 0;
  border-top: 1px solid var(--dsw-alias-border-l1); }
.ec-step:first-child { border-top: 0; }
.ec-step .ec-mark { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2);
  display: grid; place-items: center; font-size: 10px; color: var(--dsw-alias-label-secondary); margin-top: 1px; }
.ec-step[data-on="true"] .ec-mark { border-color: transparent; color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.ec-step-name { font-size: 13.2px; font-weight: 600; }
.ec-step[data-on="true"] .ec-step-name { color: var(--dsw-alias-brand-primary); }
.ec-step-goal { font-size: 12.3px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.ec-step-focus { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.ec-goal { display: flex; align-items: flex-start; gap: 9px; padding: 6px 0; font-size: 12.8px; cursor: pointer; }
.ec-goal input { margin: 2px 0 0; accent-color: var(--dsw-alias-brand-primary); }
.ec-goal[data-done="true"] { color: var(--dsw-alias-label-secondary); }

/* ----------------------------------------------------------------- progress */
.ec-curve { width: 100%; height: 96px; display: block; }
.ec-weak { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12.5px; }
.ec-weak .ec-bar { flex: 1; height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l1); overflow: hidden; }
.ec-weak .ec-bar i { display: block; height: 100%; background: var(--dsw-alias-state-warn-primary); }
.ec-big { font-size: 38px; font-weight: 700; line-height: 1.05; letter-spacing: -.02em; }
.ec-big-unit { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-secondary); margin-left: 6px; }
.ec-stat-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-bottom: 3px; }
.ec-stat-value { font-size: 17px; font-weight: 600; }

/* ------------------------------------------------------------------ settings */
.ec-settings { padding: 4px 0 40px; max-width: 760px; }
.ec-settings h2 { font-size: 14.5px; font-weight: 600; margin: 22px 0 10px; }
.ec-section-title { font-size: 11.5px; letter-spacing: .08em; color: var(--dsw-alias-label-secondary);
  margin: 22px 0 10px; }
.ec-section-title:first-child { margin-top: 0; }
.ec-settings h2:first-child { margin-top: 0; }
.ec-danger { color: var(--dsw-alias-state-error-primary); }

/* ---------------------------------------------------------------------- pill */
.ec-overlay-layer { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; }
.ec-pill { position: absolute; right: 22px; bottom: 22px; pointer-events: auto; }
.ec-pill-btn { cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
  display: flex; align-items: center; gap: 8px; border-radius: 999px; padding: 9px 14px 9px 12px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary); box-shadow: 0 6px 22px rgba(0,0,0,.16);
  font: inherit; font-size: 12.5px; }
.ec-pill-btn:hover { border-color: var(--dsw-alias-brand-primary); }
.ec-pill-btn:active { cursor: grabbing; }
.ec-pill-count { min-width: 19px; height: 19px; border-radius: 999px; background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base); font-size: 10.5px; display: inline-flex; align-items: center;
  justify-content: center; padding: 0 5px; font-variant-numeric: tabular-nums; }
.ec-pop { position: absolute; right: 0; bottom: calc(100% + 10px); width: 306px; max-height: 70vh; overflow: auto;
  border-radius: 14px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 14px 44px rgba(0,0,0,.24); padding: 15px; }
.ec-pop[data-down="true"] { top: calc(100% + 10px); bottom: auto; }
.ec-pop-head { display: flex; align-items: center; gap: 8px; font-size: 11.5px;
  color: var(--dsw-alias-label-secondary); }
.ec-pop-head b { color: var(--dsw-alias-label-primary); font-size: 12.5px; }
.ec-pop-term { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  font-size: 24px; margin: 12px 0 2px; letter-spacing: -.01em; }
.ec-pop-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.6; margin-top: 6px; }
.ec-pop-acts { display: flex; gap: 8px; margin-top: 14px; }
`
    function Style() {
      return h('style', { dangerouslySetInnerHTML: { __html: CSS } })
    }

    // ------------------------------------------------------------ primitives

    function Btn({ children, onClick, disabled, primary, ghost, small, type, style }) {
      const className = `ec-btn${primary ? ' ec-btn-primary' : ''}${ghost ? ' ec-btn-ghost' : ''}${
        small ? ' ec-btn-sm' : ''
      }`
      return h(
        'button',
        { type: type ?? 'button', className, onClick, disabled: Boolean(disabled), style },
        children
      )
    }

    function Badge({ status }) {
      return h('span', { className: 'ec-badge', 'data-tone': status }, t(status) || status)
    }

    /** 1–5 box progress, the same scale the Leitner review advances on. */
    function BoxDots({ box }) {
      return h(
        'span',
        { className: 'ec-dots', 'aria-label': `第 ${box} 盒` },
        [1, 2, 3, 4, 5].map((n) => h('i', { key: n, 'data-on': n <= (box ?? 0) }))
      )
    }

    function Ring({ value, total, label }) {
      const percent = total ? Math.round((value / total) * 100) : 0
      return h(
        'span',
        { className: 'ec-ring', style: { '--p': percent }, 'aria-label': label ?? `${percent}%` },
        h('span', null, `${percent}%`)
      )
    }

    function Field({ label, hint, children }) {
      return h(
        'div',
        { className: 'ec-field' },
        h('label', { className: 'ec-label' }, label),
        children,
        hint ? h('div', { className: 'ec-muted', style: { marginTop: 5 } }, hint) : null
      )
    }

    function Notice({ tone, children }) {
      const color =
        tone === 'error'
          ? 'var(--dsw-alias-state-error-primary)'
          : tone === 'warn'
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-label-secondary)'
      return h(
        'div',
        { className: 'ec-feedback', style: { color, marginBottom: 12 } },
        typeof children === 'string' ? children : children
      )
    }

    function useRefresh(loader, intervalMs) {
      const [state, setState] = useState({ data: null, error: null, loading: true })
      const load = useCallback(async () => {
        const result = await loader()
        if (result.ok) setState({ data: result.data, error: null, loading: false })
        else setState((prev) => ({ ...prev, error: result.message, loading: false }))
        return result
      }, [loader])
      useEffect(() => {
        let alive = true
        void load()
        if (!intervalMs) return () => { alive = false }
        const timer = setInterval(() => {
          if (alive) void load()
        }, intervalMs)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [load, intervalMs])
      return { ...state, reload: load }
    }

    const loadState = () => call('state.get')
    const loadProgress = () => call('progress.get')
    const loadWords = () => call('review.list')

    // -------------------------------------------------------------- onboarding

    const GOALS = ['work', 'study', 'travel', 'media', 'exam', 'other']
    const BANDS = ['入门', '初级', '中级', '中高级', '高级', '精通']

    function Onboarding({ onSaved }) {
      const [form, setForm] = useState({
        goal: 'work',
        minutesPerDay: 30,
        targetBand: '中级',
        interests: '',
        workContext: ''
      })
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [guessed, setGuessed] = useState(false)

      // A first guess from the current workspace, so the learner confirms or
      // corrects it instead of describing their work from scratch.
      useEffect(() => {
        void (async () => {
          const inferred = await call('profile.infer')
          if (!inferred.ok || !inferred.data?.workContext) return
          setForm((current) =>
            current.workContext ? current : { ...current, workContext: inferred.data.workContext }
          )
          setGuessed(true)
        })()
      }, [])

      const submit = async () => {
        setBusy(true)
        const result = await call('profile.save', {
          goal: form.goal,
          minutesPerDay: Number(form.minutesPerDay),
          targetBand: form.targetBand,
          workContext: form.workContext,
          interests: form.interests
            .split(/[,，]/)
            .map((item) => item.trim())
            .filter(Boolean)
        })
        setBusy(false)
        if (!result.ok) {
          setError(result.message)
          return
        }
        setError(null)
        await onSaved()
      }

      return h(
        'div',
        { className: 'ec-card' },
        h('h2', null, t('onboardTitle')),
        h('div', { className: 'ec-muted', style: { marginBottom: 14 } }, t('onboardHint')),
        guessed
          ? h(
              Field,
              { label: t('workContext'), hint: t('workContextHint') },
              h('input', {
                className: 'ec-input',
                type: 'text',
                value: form.workContext,
                onChange: (event) => setForm({ ...form, workContext: event.target.value })
              })
            )
          : null,
        h(
          Field,
          { label: t('goal') },
          h(
            'select',
            {
              className: 'ec-select',
              value: form.goal,
              onChange: (event) => setForm({ ...form, goal: event.target.value })
            },
            GOALS.map((goal) =>
              h('option', { key: goal, value: goal }, t(`goal${goal[0].toUpperCase()}${goal.slice(1)}`))
            )
          )
        ),
        h(
          Field,
          { label: t('minutes') },
          h('input', {
            className: 'ec-input',
            type: 'number',
            min: 5,
            max: 180,
            value: form.minutesPerDay,
            onChange: (event) => setForm({ ...form, minutesPerDay: event.target.value })
          })
        ),
        h(
          Field,
          { label: t('targetBand') },
          h(
            'select',
            {
              className: 'ec-select',
              value: form.targetBand,
              onChange: (event) => setForm({ ...form, targetBand: event.target.value })
            },
            BANDS.map((band) => h('option', { key: band, value: band }, band))
          )
        ),
        h(
          Field,
          { label: t('interests'), hint: t('interestsHint') },
          h('input', {
            className: 'ec-input',
            type: 'text',
            value: form.interests,
            onChange: (event) => setForm({ ...form, interests: event.target.value })
          })
        ),
        error ? h(Notice, { tone: 'error' }, error) : null,
        h(
          'div',
          { className: 'ec-row' },
          h(Btn, { primary: true, onClick: submit, disabled: busy }, busy ? t('saving') : t('save'))
        ),
        h('div', { className: 'ec-muted', style: { marginTop: 12 } }, t('assessmentFirst'))
      )
    }

    // ----------------------------------------------------------- study items

    function Speak({ text, provider }) {
      const [playing, setPlaying] = useState(false)
      const audio = useMemo(() => audioProvider(provider), [provider])
      const supported = useMemo(() => audio.available(), [audio])

      useEffect(() => () => audio.stop(), [audio])

      if (!supported) {
        return h('div', { className: 'ec-muted' }, t('noSpeech'))
      }
      return h(
        'div',
        { className: 'ec-row', style: { margin: '10px 0' } },
        h(
          Btn,
          {
            onClick: () => {
              audio.speak(text, { onEnd: () => setPlaying(false) })
              setPlaying(true)
            }
          },
          playing ? t('replay') : t('play')
        ),
        h(
          Btn,
          {
            onClick: () => {
              audio.pause()
              setPlaying(false)
            },
            disabled: !playing
          },
          t('pause')
        )
      )
    }

    function SourceLine({ source }) {
      if (!source) return null
      return h(
        'div',
        { className: 'ec-muted', style: { marginTop: 10, wordBreak: 'break-all' } },
        `${t('source')}：`,
        h('a', { href: source.url, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-brand-primary)' } }, source.title || source.url),
        `　${t('fetchedAt')} ${String(source.fetchedAt).slice(0, 10)}　${t('license')}：${source.license}`
      )
    }

    function ReadingItem({ item, lesson }) {
      const source = (lesson.sources ?? []).find((candidate) => candidate.id === item.sourceId)
      return h(
        'div',
        null,
        h('div', { className: 'ec-body' }, item.body),
        h(SourceLine, { source })
      )
    }

    function ListeningItem({ item, lesson, provider }) {
      const source = (lesson.sources ?? []).find((candidate) => candidate.id === item.sourceId)
      return h(
        'div',
        null,
        h(Speak, { text: item.transcript, provider }),
        h('div', { className: 'ec-transcript' }, item.transcript),
        h(SourceLine, { source })
      )
    }

    function ExpressionsItem({ item }) {
      return h(
        'div',
        null,
        (item.expressions ?? []).map((expression, index) =>
          h(
            'div',
            { key: index, style: { marginBottom: 12 } },
            h('div', { style: { fontSize: 14.5, fontWeight: 600 } }, expression.term),
            expression.example
              ? h('div', { className: 'ec-body', style: { fontSize: 13.5, marginTop: 4 } }, expression.example)
              : null,
            h('div', { className: 'ec-muted', style: { marginTop: 5 } }, expression.meaning)
          )
        )
      )
    }

    function ChoiceList({ choices, answerIndex, picked, onPick, disabled }) {
      const answered = picked !== null && picked !== undefined
      return h(
        'div',
        { className: 'ec-choices' },
        choices.map((choice, index) => {
          let stateName = null
          if (answered) {
            if (index === answerIndex) stateName = 'right'
            else if (index === picked) stateName = 'wrong'
            else stateName = 'dim'
          }
          return h(
            'button',
            {
              key: index,
              type: 'button',
              className: 'ec-choice',
              'data-state': stateName ?? undefined,
              disabled: disabled || answered,
              onClick: () => onPick(index)
            },
            h('span', { className: 'ec-key' }, String(index + 1)),
            h('span', null, choice)
          )
        })
      )
    }

    function QuizItem({ item }) {
      const [picked, setPicked] = useState(null)
      const questions = item.questions ?? []
      return h(
        'div',
        null,
        questions.map((question, index) => {
          const answered = picked && picked.question === index
          return h(
            'div',
            { key: question.id ?? index, style: { marginBottom: 14 } },
            h('div', { style: { fontSize: 13.5, marginBottom: 4 } }, question.prompt),
            h(ChoiceList, {
              choices: question.choices,
              answerIndex: answered ? question.answerIndex : -1,
              picked: answered ? picked.choice : null,
              onPick: (choice) => setPicked({ question: index, choice })
            }),
            answered
              ? h(
                  'div',
                  { className: 'ec-feedback' },
                  `${picked.choice === question.answerIndex ? t('correct') : t('wrong')}　`,
                  question.explanation || ''
                )
              : null
          )
        })
      )
    }

    function OrderingItem({ item }) {
      const words = item.words ?? []
      const [picked, setPicked] = useState([])
      const [checked, setChecked] = useState(null)
      const used = new Set(picked)

      const joined = picked.map((index) => words[index]).join(' ')
      const correct = joined.trim() === String(item.answer).trim()

      return h(
        'div',
        null,
        h('div', { className: 'ec-muted', style: { marginBottom: 6 } }, item.prompt || t('orderHint')),
        h(
          'div',
          { className: 'ec-chip-row' },
          words.map((word, index) =>
            h(
              'button',
              {
                key: index,
                type: 'button',
                className: 'ec-word',
                'data-used': used.has(index),
                disabled: used.has(index) || checked !== null,
                onClick: () => setPicked([...picked, index])
              },
              word
            )
          )
        ),
        picked.length
          ? h('div', { className: 'ec-feedback' }, `${t('yourAnswer')}：${joined}`)
          : null,
        h(
          'div',
          { className: 'ec-row', style: { marginTop: 8 } },
          h(
            Btn,
            { onClick: () => setChecked(correct), disabled: !picked.length || checked !== null },
            t('orderCheck')
          ),
          h(
            Btn,
            {
              ghost: true,
              onClick: () => {
                setPicked([])
                setChecked(null)
              }
            },
            t('orderReset')
          )
        ),
        checked !== null
          ? h(
              'div',
              { className: 'ec-feedback', style: { color: checked ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } },
              checked ? t('correct') : `${t('correctOrder')}：${item.answer}`,
              item.explanation ? `　${item.explanation}` : ''
            )
          : null
      )
    }

    // ----------------------------------------------------------------- lesson

    function typeLabel(type) {
      const labels = {
        reading: t('itemReading'),
        listening: t('itemListening'),
        expressions: t('itemExpressions'),
        quiz: t('itemQuiz'),
        ordering: t('itemOrdering')
      }
      return labels[type] ?? type
    }

    function formatDay(iso) {
      if (!iso) return ''
      const [year, month, day] = String(iso).slice(0, 10).split('-')
      return `${Number(month)} 月 ${Number(day)} 日`
    }

    function dueLabel(item, nowIso) {
      if (item.due) return t('dueTodayShort')
      const days = Math.ceil((Date.parse(item.dueAt) - Date.parse(nowIso)) / 86400000)
      if (days <= 1) return t('tomorrow')
      if (days < 30) return t('daysAfter', { n: days })
      return formatDay(item.dueAt)
    }

    function ItemBody({ item, lesson, settings }) {
      if (item.type === 'reading') return h(ReadingItem, { item, lesson })
      if (item.type === 'listening')
        return h(ListeningItem, { item, lesson, provider: settings?.audio?.provider })
      if (item.type === 'expressions') return h(ExpressionsItem, { item })
      if (item.type === 'quiz') return h(QuizItem, { item })
      if (item.type === 'ordering') return h(OrderingItem, { item })
      return null
    }

    /**
     * One row of the lesson. Collapsed by default so the card stays a plan, not
     * a wall of text; the next unfinished item opens itself.
     */
    function LessonItemRow({ item, lesson, settings, open, onToggle, onComplete }) {
      const [busy, setBusy] = useState(false)
      return h(
        'div',
        null,
        h(
          'button',
          {
            type: 'button',
            className: 'ec-li',
            'data-done': Boolean(item.done),
            'data-open': Boolean(open),
            onClick: onToggle
          },
          h('span', { className: 'ec-type' }, typeLabel(item.type)),
          h('span', { className: 'ec-name' }, item.title || ''),
          h('span', { className: 'ec-min' }, `${item.minutes ?? 0}′`),
          h('span', { className: 'ec-check' }, '✓')
        ),
        open
          ? h(
              'div',
              { className: 'ec-item-body' },
              h(ItemBody, { item, lesson, settings }),
              item.done
                ? null
                : h(
                    'div',
                    { className: 'ec-row', style: { marginTop: 12 } },
                    h(
                      Btn,
                      {
                        primary: true,
                        small: true,
                        disabled: busy,
                        onClick: async () => {
                          setBusy(true)
                          await onComplete(item.id)
                          setBusy(false)
                        }
                      },
                      t('finishItem')
                    )
                  )
            )
          : null
      )
    }

    function LessonCard({ lesson, settings, onStart, onComplete, onGenerate, job }) {
      const items = lesson.items ?? []
      const remaining = items.filter((item) => !item.done)
      const remainingMinutes = remaining.reduce((sum, item) => sum + (item.minutes || 0), 0)
      const next = remaining[0] ?? null
      const active = lesson.status === 'active' || lesson.status === 'done'
      const cards = lesson.cards ?? []
      const pending = job && job.status === 'pending'
      const [openId, setOpenId] = useState(null)
      const [openCards, setOpenCards] = useState({})
      const seeded = useRef(false)

      useEffect(() => {
        if (seeded.current || !active) return
        seeded.current = true
        setOpenId(next ? next.id : null)
      }, [active, next])

      return h(
        'section',
        { className: 'ec-card' },
        h(
          'div',
          { className: 'ec-card-head' },
          h('h2', null, t('todayLesson')),
          h(Badge, { status: lesson.status }),
          active && remaining.length
            ? h('span', { className: 'ec-sub' }, t('remainingItems', { n: remaining.length, min: remainingMinutes }))
            : null
        ),
        h('div', { className: 'ec-lesson-title' }, lesson.title),
        lesson.summary ? h('div', { className: 'ec-lesson-sum' }, lesson.summary) : null,
        lesson.note
          ? h(
              'details',
              { style: { marginTop: 8 } },
              h('summary', { className: 'ec-sub', style: { cursor: 'pointer' } }, t('sourceNote')),
              h('div', { className: 'ec-muted', style: { marginTop: 6, fontSize: 11.5 } }, lesson.note)
            )
          : null,
        lesson.status === 'draft'
          ? h(
              'div',
              { style: { marginTop: 14 } },
              h('div', { className: 'ec-muted', style: { marginBottom: 10 } }, t('draftReady')),
              h(
                'div',
                { className: 'ec-row' },
                h(Btn, { primary: true, onClick: onStart }, t('startLesson')),
                h(
                  Btn,
                  { ghost: true, onClick: onGenerate, disabled: pending },
                  pending ? t('generating') : t('regenerate')
                )
              )
            )
          : null,
        lesson.status === 'expired' ? h(Notice, { tone: 'warn' }, t('expiredHint')) : null,
        active
          ? h(
              'div',
              { className: 'ec-items' },
              items.map((item) =>
                h(LessonItemRow, {
                  key: item.id,
                  item,
                  lesson,
                  settings,
                  open: openId === item.id,
                  onToggle: () => setOpenId(openId === item.id ? null : item.id),
                  onComplete
                })
              )
            )
          : null,
        active && next
          ? h(
              'div',
              { className: 'ec-row', style: { marginTop: 14 } },
              h(
                Btn,
                { primary: true, onClick: () => setOpenId(next.id) },
                t('continueLesson', { type: typeLabel(next.type), min: next.minutes ?? 0 })
              )
            )
          : null,
        cards.length
          ? h(
              'div',
              null,
              h('hr', { className: 'ec-hair' }),
              h('div', { className: 'ec-sub', style: { marginBottom: 6 } }, t('lessonCards')),
              cards.map((card) => {
                const revealed = Boolean(openCards[card.id])
                return h(
                  'button',
                  {
                    key: card.id,
                    type: 'button',
                    className: 'ec-flash',
                    'data-open': revealed,
                    onClick: () => setOpenCards({ ...openCards, [card.id]: !revealed })
                  },
                  h('div', { className: 'ec-flash-front' }, card.front),
                  revealed
                    ? h(
                        'div',
                        { className: 'ec-flash-back' },
                        card.back,
                        card.explanation ? h('div', { className: 'ec-muted' }, card.explanation) : null
                      )
                    : h('div', { className: 'ec-flash-hint' }, t('tapAnswer'))
                )
              })
            )
          : null
      )
    }

    function EmptyLessonCard({ onGenerate, pending, busy }) {
      return h(
        'section',
        { className: 'ec-card' },
        h('div', { className: 'ec-empty' }, t('noLesson')),
        h('div', { className: 'ec-muted', style: { textAlign: 'center' } }, t('noLessonHint')),
        h(
          'div',
          { className: 'ec-row', style: { justifyContent: 'center', marginTop: 14 } },
          h(
            Btn,
            { primary: true, onClick: onGenerate, disabled: busy || pending },
            pending ? t('generating') : t('generateToday')
          )
        )
      )
    }

    function ProgressStrip({ data, lesson, onTab }) {
      const items = lesson?.items ?? []
      const done = items.filter((item) => item.done).length
      const total = items.length
      const remaining = items.filter((item) => !item.done)
      const minutes = remaining.reduce((sum, item) => sum + (item.minutes || 0), 0)
      return h(
        'section',
        { className: 'ec-card' },
        h(
          'div',
          { className: 'ec-row', style: { gap: 16, flexWrap: 'nowrap' } },
          h(Ring, { value: done, total, label: `${done}/${total}` }),
          h(
            'div',
            { style: { minWidth: 0 } },
            h(
              'div',
              { style: { fontSize: 12.8 } },
              total ? t('todayIndex', { done, total }) : t('noLessonShort')
            ),
            h(
              'div',
              { className: 'ec-sub', style: { marginTop: 2 } },
              t('streakAndMastered', {
                streak: data.streak?.current ?? 0,
                mastered: data.review?.mastered ?? 0
              }),
              minutes ? ` · ${t('remainingShort', { min: minutes })}` : ''
            )
          ),
          h(
            Btn,
            { ghost: true, small: true, style: { marginLeft: 'auto' }, onClick: () => onTab('progress') },
            t('viewProgress')
          )
        )
      )
    }

    function WeeklyCard({ data, reload }) {
      const weekly = data.syllabus?.weekly ?? { goals: [], completedGoals: 0, totalGoals: 0 }
      const goals = weekly.goals ?? []
      const toggle = async (goalId, done) => {
        await call('syllabus.toggleGoal', { goalId, done })
        await reload()
      }
      return h(
        'section',
        { className: 'ec-card' },
        h(
          'div',
          { className: 'ec-card-head' },
          h('h2', null, t('weekGoals')),
          h('span', { className: 'ec-sub' }, `${weekly.completedGoals ?? 0} / ${weekly.totalGoals ?? 0}`)
        ),
        goals.length
          ? h(
              'div',
              { style: { marginTop: 6 } },
              goals.map((goal) =>
                h(
                  'label',
                  { key: goal.id, className: 'ec-goal', 'data-done': Boolean(goal.done) },
                  h('input', {
                    type: 'checkbox',
                    checked: Boolean(goal.done),
                    onChange: (event) => void toggle(goal.id, event.target.checked)
                  }),
                  h('span', null, goal.text)
                )
              )
            )
          : h('div', { className: 'ec-empty' }, t('weekEmpty'))
      )
    }

    // ------------------------------------------------------------------ words

    /**
     * The review session. It snapshots the due items when it opens, so answering
     * one does not slide the next card out from under the feedback panel.
     */
    function WordDeck({ words, now, compact, limit = 10, reloadWords, onAnswered, onGoWords }) {
      const items = words?.data?.items ?? []
      const [ids, setIds] = useState(null)
      const [index, setIndex] = useState(0)
      const [picked, setPicked] = useState(null)
      const [feedback, setFeedback] = useState(null)
      const [correct, setCorrect] = useState(0)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [job, setJob] = useState(null)

      const begin = (list) => {
        const due = (list?.items ?? []).filter((item) => item.due)
        setIds(due.slice(0, limit).map((item) => item.id))
        setIndex(0)
        setPicked(null)
        setFeedback(null)
        setCorrect(0)
        setError(null)
      }

      useEffect(() => {
        if (ids !== null || !words?.data) return
        begin(words.data)
        // begin is intentionally not a dependency: the snapshot should happen once
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [ids, words, items])

      const word = ids && ids[index] ? items.find((item) => item.id === ids[index]) : null
      const finished = ids !== null && ids.length > 0 && index >= ids.length
      const isLast = ids !== null && index + 1 >= ids.length
      const dueLeft = words?.data?.dueCount ?? 0
      const generating = job?.status === 'pending'

      const answer = async (choice) => {
        if (!word || picked !== null || busy) return
        setPicked(choice)
        setBusy(true)
        setError(null)
        const result = await call('review.answer', { itemId: word.id, choice })
        setBusy(false)
        if (!result.ok) {
          setPicked(null)
          setFeedback(null)
          setError(result.message)
          return
        }
        if (result.data.correct) setCorrect((value) => value + 1)
        setFeedback({ correct: result.data.correct, explanation: result.data.explanation ?? word.explanation })
        if (onAnswered) void onAnswered()
      }

      const next = () => {
        setPicked(null)
        setFeedback(null)
        setIndex((value) => value + 1)
      }

      /** Ask the Agent for another batch of words, then start a session on them. */
      const generateMore = async () => {
        if (generating) return
        setError(null)
        const result = await call('generate.vocab')
        if (!result.ok) {
          setError(result.message)
          return
        }
        setJob(result.data)
      }

      useEffect(() => {
        if (!job || job.status !== 'pending') return undefined
        const timer = setInterval(async () => {
          const status = await call('job.status', { kind: 'vocab' })
          if (!status.ok || !status.data) return
          setJob(status.data)
          if (status.data.status === 'pending') return
          if (status.data.status === 'failed') {
            setError(status.data.failure ?? t('generateFailed'))
            return
          }
          const fresh = reloadWords ? await reloadWords() : null
          if (fresh?.ok) {
            if ((fresh.data.items ?? []).some((item) => item.due)) begin(fresh.data)
            else setError(t('vocabEmpty'))
          }
          if (onAnswered) void onAnswered()
        }, 4000)
        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [job, limit, reloadWords])

      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          const tag = (event.target?.tagName || '').toLowerCase()
          if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return
          if (!word || picked !== null || busy) {
            if (event.key === 'Enter' && feedback) next()
            return
          }
          if (['1', '2', '3', '4'].includes(event.key)) {
            event.preventDefault()
            void answer(Number(event.key) - 1)
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      })

      useEffect(() => {
        const start = () => void generateMore()
        vocabRequests.add(start)
        return () => vocabRequests.delete(start)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      })

      const generateButton = (label) =>
        h(
          Btn,
          { primary: true, small: true, disabled: generating, onClick: generateMore },
          generating ? t('generatingWords') : label
        )

      let body = null
      if (!ids) {
        body = h('div', { className: 'ec-empty' }, t('loading'))
      } else if (finished) {
        body = h(
          'div',
          { className: 'ec-done-card' },
          h('div', { className: 'ec-done-mark' }, '✓'),
          h('h2', null, t('reviewDone')),
          h('div', { className: 'ec-muted', style: { marginTop: 6 } }, t('reviewDoneHint', { n: correct })),
          h(
            'div',
            { className: 'ec-acts' },
            dueLeft > 0
              ? h(
                  Btn,
                  { primary: true, small: true, onClick: () => begin(words.data) },
                  t('continueReview', { n: dueLeft })
                )
              : generateButton(t('continueLearning')),
            onGoWords ? h(Btn, { ghost: true, small: true, onClick: onGoWords }, t('openLibrary')) : null
          ),
          dueLeft > 0 || generating
            ? null
            : h('div', { className: 'ec-sub', style: { marginTop: 8 } }, t('continueLearningHint', { n: limit })),
          error ? h(Notice, { tone: 'error' }, error) : null
        )
      } else if (!word) {
        const nextDue = words?.data?.nextDueAt
        body = h(
          'div',
          { style: { padding: '10px 0 4px' } },
          h('div', { className: 'ec-empty', style: { padding: '8px 0' } }, t('nothingDue')),
          nextDue
            ? h(
                'div',
                { className: 'ec-muted', style: { textAlign: 'center' } },
                t('nextDue', {
                  date: formatDay(nextDue),
                  n: words?.data?.nextDueCount ?? 0
                })
              )
            : null,
          h(
            'div',
            { style: { textAlign: 'center', marginTop: 14 } },
            generateButton(t('continueLearning')),
            h(
              'div',
              { className: 'ec-sub', style: { marginTop: 6 } },
              generating ? t('generatingWordsHint') : t('continueLearningHint', { n: limit })
            )
          ),
          onGoWords
            ? h(
                'div',
                { style: { textAlign: 'center', marginTop: 10 } },
                h(Btn, { ghost: true, small: true, onClick: onGoWords }, t('openLibrary'))
              )
            : null,
          error ? h(Notice, { tone: 'error' }, error) : null
        )
      } else {
        body = h(
          'div',
          { className: 'ec-deck', 'data-compact': Boolean(compact) },
          h(
            'div',
            { className: 'ec-deck-meta' },
            word.fresh ? h('span', { className: 'ec-chip ec-chip-brand' }, t('newWord')) : null,
            h('span', { className: 'ec-chip' }, word.kind === 'word' ? t('wordKind') : t('expressionKind')),
            h(BoxDots, { box: word.box }),
            h('span', { className: 'ec-sub' }, `${index + 1} / ${ids.length}`)
          ),
          h('div', { className: 'ec-deck-term' }, word.term),
          h('div', { className: 'ec-deck-prompt' }, t('pickMeaning')),
          h(ChoiceList, {
            choices: word.choices ?? [],
            answerIndex: word.answerIndex,
            picked,
            onPick: (choice) => void answer(choice),
            disabled: busy
          }),
          error ? h(Notice, { tone: 'error' }, error) : null,
          feedback
            ? h(
                'div',
                { className: 'ec-fb', 'data-tone': feedback.correct ? 'ok' : 'err' },
                h('div', { className: 'ec-verdict' }, feedback.correct ? t('correct') : t('wrong')),
                h('div', { className: 'ec-meaning' }, word.meaning),
                feedback.explanation ? h('div', { className: 'ec-note' }, feedback.explanation) : null,
                h(
                  'div',
                  { className: 'ec-acts' },
                  h(Btn, { primary: true, small: true, onClick: next }, isLast ? t('finishReview') : t('nextWord')),
                  h('span', { className: 'ec-kbd' }, t('kbdHint'))
                )
              )
            : h('div', { className: 'ec-kbd', style: { marginTop: 10 } }, t('kbdPick'))
        )
      }

      return h(
        'section',
        { className: 'ec-card' },
        h(
          'div',
          { className: 'ec-card-head' },
          h('h2', null, t('dueReview')),
          h(
            'span',
            { className: 'ec-sub' },
            dueLeft ? `${Math.min(dueLeft, limit)} / ${dueLeft}` : t('nothingDueShort')
          )
        ),
        body
      )
    }

    function Library({ words, now }) {
      const [filter, setFilter] = useState('all')
      const [openId, setOpenId] = useState(null)
      const items = words?.data?.items ?? []
      const open = openId ? items.find((item) => item.id === openId) : null

      useEffect(() => {
        if (!openId) return undefined
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setOpenId(null)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [openId])
      const list = items.filter((item) =>
        filter === 'all' ? true : filter === 'learning' ? item.status !== 'mastered' : item.status === 'mastered'
      )
      const counts = {
        all: items.length,
        learning: items.filter((item) => item.status !== 'mastered').length,
        mastered: items.filter((item) => item.status === 'mastered').length
      }
      return h(
        'section',
        { className: 'ec-card' },
        h(
          'div',
          { className: 'ec-card-head' },
          h('h2', null, t('library')),
          h('span', { className: 'ec-sub' }, String(items.length))
        ),
        h(
          'div',
          { className: 'ec-lib-filter' },
          [
            ['all', t('libraryAll')],
            ['learning', t('libraryLearning')],
            ['mastered', t('libraryMastered')]
          ].map(([id, label]) =>
            h(
              'button',
              { key: id, type: 'button', 'data-on': filter === id, onClick: () => setFilter(id) },
              `${label} ${counts[id]}`
            )
          )
        ),
        list.length
          ? h(
              'div',
              { className: 'ec-lib-list' },
              list.map((item) =>
                h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    className: 'ec-lib-row',
                    onClick: () => setOpenId(item.id)
                  },
                  h('span', { className: 'ec-lib-term' }, item.term),
                  h('span', { className: 'ec-chip' }, item.kind === 'word' ? t('wordKind') : t('expressionKind')),
                  h(BoxDots, { box: item.box }),
                  h('span', { className: 'ec-when' }, dueLabel(item, now))
                )
              )
            )
          : h('div', { className: 'ec-empty' }, t('libraryEmpty')),
        h('div', { className: 'ec-sub', style: { marginTop: 10 } }, t('libraryHint')),
        open
          ? h(
              'div',
              { className: 'ec-modal-back', onClick: () => setOpenId(null) },
              h(
                'div',
                { className: 'ec-modal', onClick: (event) => event.stopPropagation() },
                h(
                  'div',
                  { className: 'ec-modal-head' },
                  h(
                    Btn,
                    {
                      ghost: true,
                      small: true,
                      onClick: () => setOpenId(null)
                    },
                    t('collapse')
                  )
                ),
                h('div', { className: 'ec-modal-term' }, open.term),
                h('div', { className: 'ec-modal-meaning' }, open.meaning),
                open.explanation ? h('div', { className: 'ec-note' }, open.explanation) : null,
                h(
                  'dl',
                  { className: 'ec-kv' },
                  h('dt', null, t('nextReview')),
                  h('dd', null, open.due ? t('dueTodayShort') : formatDay(open.dueAt)),
                  h('dt', null, t('attemptsLabel')),
                  h('dd', null, t('attemptsValue', { n: open.answerCount ?? 0, wrong: open.lapses ?? 0 }))
                )
              )
            )
          : null
      )
    }

    function TodayTab({ data, words, reload, reloadWords, onTab }) {
      const [job, setJob] = useState(null)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const lesson = data.todayLesson

      useEffect(() => {
        let alive = true
        void (async () => {
          const result = await call('job.status', { kind: 'lesson' })
          if (alive && result.ok && result.data && result.data.date === data.today) setJob(result.data)
        })()
        return () => {
          alive = false
        }
      }, [data.today])

      useEffect(() => {
        if (!job || job.status !== 'pending') return
        const timer = setInterval(async () => {
          const result = await call('job.status', { kind: 'lesson' })
          if (!result.ok) return
          setJob(result.data)
          if (result.data && result.data.status !== 'pending') {
            await reload()
          }
        }, 4000)
        return () => clearInterval(timer)
      }, [job, reload])

      const generate = async () => {
        setBusy(true)
        setNotice(null)
        const result = await call('generate')
        setBusy(false)
        if (!result.ok) {
          setNotice({ tone: 'error', text: result.message })
          return
        }
        setJob(result.data)
      }

      const start = async () => {
        const result = await call('lesson.start', { date: data.today })
        if (!result.ok) setNotice({ tone: 'error', text: result.message })
        await reload()
      }

      const complete = async (itemId) => {
        const result = await call('lesson.completeItem', { date: data.today, itemId })
        if (!result.ok) setNotice({ tone: 'error', text: result.message })
        await reload()
      }

      const pending = job && job.status === 'pending'
      const failed = job && job.status === 'failed'

      return h(
        'div',
        null,
        notice ? h(Notice, { tone: notice.tone }, notice.text) : null,
        failed ? h(Notice, { tone: 'error' }, `${t('generateFailed')}：${job.failure ?? ''}`) : null,
        pending ? h(Notice, null, t('generating')) : null,
        h(
          'div',
          { className: 'ec-grid' },
          h(
            'div',
            { className: 'ec-col' },
            lesson
              ? h(LessonCard, {
                  lesson,
                  settings: data.settings,
                  onStart: start,
                  onComplete: complete,
                  onGenerate: generate,
                  job
                })
              : h(EmptyLessonCard, { onGenerate: generate, pending, busy }),
            h(ProgressStrip, { data, lesson, onTab })
          ),
          h(
            'div',
            { className: 'ec-col' },
            h(WordDeck, {
              words,
              now: data.now,
              compact: true,
              limit: data.settings?.study?.wordsPerDay ?? 10,
              reloadWords,
              onAnswered: async () => {
                await reload()
                await reloadWords()
              },
              onGoWords: () => onTab('words')
            }),
            h(WeeklyCard, { data, reload })
          )
        )
      )
    }

    // ------------------------------------------------------------------- plan

    function PlanTab({ data, reload }) {
      const phases = data.syllabus?.phases ?? []
      const weekly = data.syllabus?.weekly ?? { goals: [], completedGoals: 0, totalGoals: 0 }
      const currentId = data.syllabus?.currentPhaseId
      const currentIndex = phases.findIndex((phase) => phase.id === currentId)

      if (!phases.length) {
        return h(
          'div',
          { className: 'ec-page' },
          h(
            'section',
            { className: 'ec-card' },
            h('div', { className: 'ec-empty' }, t('noSyllabus')),
            h(
              'div',
              { className: 'ec-row', style: { justifyContent: 'center' } },
              h(
                Btn,
                {
                  primary: true,
                  onClick: async () => {
                    await call('syllabus.generate')
                    await reload()
                  }
                },
                t('regenerateSyllabus')
              )
            )
          )
        )
      }

      return h(
        'div',
        { className: 'ec-grid' },
        h(
          'div',
          { className: 'ec-col' },
          h(
            'section',
            { className: 'ec-card' },
            h(
              'div',
              { className: 'ec-card-head' },
              h('h2', null, t('planTitle')),
              h(
                'span',
                { className: 'ec-sub' },
                currentIndex >= 0 ? t('phaseIndex', { n: currentIndex + 1, total: phases.length }) : ''
              )
            ),
            h(
              'div',
              { className: 'ec-timeline', style: { marginTop: 8 } },
              phases.map((phase, index) =>
                h(
                  'div',
                  { key: phase.id, className: 'ec-step', 'data-on': phase.id === currentId },
                  h('span', { className: 'ec-mark' }, phase.id === currentId ? '●' : String(index + 1)),
                  h(
                    'div',
                    null,
                    h('div', { className: 'ec-step-name' }, phase.name),
                    h('div', { className: 'ec-step-goal' }, phase.goal),
                    (phase.focus ?? []).length
                      ? h(
                          'div',
                          { className: 'ec-step-focus' },
                          (phase.focus ?? []).map((text) =>
                            h('span', { key: text, className: 'ec-chip' }, text)
                          )
                        )
                      : null,
                    phase.targetBand
                      ? h(
                          'div',
                          { className: 'ec-step-focus', style: { marginTop: 6 } },
                          h('span', { className: 'ec-chip ec-chip-brand' }, phase.targetBand)
                        )
                      : null
                  )
                )
              )
            )
          )
        ),
        h(
          'div',
          { className: 'ec-col' },
          h(WeeklyCard, { data, reload }),
          h(
            'section',
            { className: 'ec-card' },
            h('h2', null, t('routeTitle')),
            h('div', { className: 'ec-muted', style: { marginTop: 8 } }, t('routeNote')),
            h(
              'div',
              { style: { marginTop: 12 } },
              h(
                Btn,
                {
                  ghost: true,
                  small: true,
                  onClick: async () => {
                    await call('syllabus.generate')
                    await reload()
                  }
                },
                t('rewriteRoute')
              )
            )
          )
        )
      )
    }

    // -------------------------------------------------------------- progress

    const SKILL_LABEL = {
      grammar: '语法',
      vocab: '词汇',
      reading: '阅读',
      listening: '听力',
      inference: '推断'
    }

    function Curve({ points }) {
      if (!points || points.length < 2) {
        return h('div', { className: 'ec-empty' }, t('noCurve'))
      }
      const width = 560
      const height = 120
      const pad = 12
      const xs = points.map(
        (_, index) => pad + (index * (width - pad * 2)) / Math.max(1, points.length - 1)
      )
      const ys = points.map(
        (point) => height - pad - ((Math.min(6, Math.max(1, point.estimate)) - 1) / 5) * (height - pad * 2)
      )
      const d = xs
        .map((x, index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[index].toFixed(1)}`)
        .join(' ')
      return h(
        'svg',
        { className: 'ec-curve', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' },
        h('path', {
          d,
          fill: 'none',
          stroke: 'var(--dsw-alias-brand-primary)',
          strokeWidth: 2.2,
          strokeLinejoin: 'round',
          strokeLinecap: 'round'
        }),
        points.map((point, index) =>
          h('circle', {
            key: index,
            cx: xs[index],
            cy: ys[index],
            r: 3.4,
            fill: 'var(--dsw-alias-brand-primary)'
          })
        )
      )
    }

    function ProgressTab({ data }) {
      const { data: progress, error } = useRefresh(loadProgress, 20000)
      const [showDiagnostics, setShowDiagnostics] = useState(false)

      if (error) return h('section', { className: 'ec-card' }, h(Notice, { tone: 'error' }, error))
      if (!progress) {
        return h('section', { className: 'ec-card' }, h('div', { className: 'ec-empty' }, t('loading')))
      }

      const latest = data.level?.latest
      const weaknesses = latest?.weaknesses ?? []
      const biggest = weaknesses.reduce((max, item) => Math.max(max, item.missed ?? 0), 1)

      return h(
        'div',
        { className: 'ec-grid' },
        h(
          'div',
          { className: 'ec-col' },
          h(
            'section',
            { className: 'ec-card' },
            h('h2', null, t('progressTitle')),
            h(
              'div',
              { className: 'ec-stats', style: { marginTop: 12 } },
              h('div', { className: 'ec-stat' }, h('b', null, String(progress.completions.length)), h('span', null, t('completedDays'))),
              h('div', { className: 'ec-stat' }, h('b', null, String(progress.streak.current)), h('span', null, t('streakDays'))),
              h('div', { className: 'ec-stat' }, h('b', null, String(progress.mastered)), h('span', null, t('masteredWords'))),
              h('div', { className: 'ec-stat' }, h('b', null, String(progress.learning)), h('span', null, t('learningWords')))
            ),
            progress.streak.best > progress.streak.current
              ? h('div', { className: 'ec-sub', style: { marginTop: 10 } }, t('bestStreak', { n: progress.streak.best }))
              : null
          ),
          h(
            'section',
            { className: 'ec-card' },
            h(
              'div',
              { className: 'ec-card-head' },
              h('h2', null, t('curve')),
              h('span', { className: 'ec-sub' }, latest ? latest.band : '')
            ),
            h(Curve, { points: progress.curve }),
            progress.drift && progress.drift.note
              ? h('div', { className: 'ec-muted', style: { marginTop: 8 } }, `${t('driftNote')}：${progress.drift.note}`)
              : null
          )
        ),
        h(
          'div',
          { className: 'ec-col' },
          h(
            'section',
            { className: 'ec-card' },
            h(
              'div',
              { className: 'ec-card-head' },
              h('h2', null, t('band')),
              latest ? h('span', { className: 'ec-chip ec-chip-brand' }, latest.band) : null
            ),
            latest
              ? h('div', { className: 'ec-muted', style: { marginTop: 8 } }, latest.reference ?? '')
              : h('div', { className: 'ec-empty' }, t('assessmentFirst'))
          ),
          h(
            'section',
            { className: 'ec-card' },
            h('h2', null, t('resultWeak')),
            weaknesses.length
              ? h(
                  'div',
                  { style: { marginTop: 8 } },
                  weaknesses.map((item) => {
                    const label = SKILL_LABEL[item.skill] ?? item.skill
                    return h(
                      'div',
                      { key: item.skill, className: 'ec-weak' },
                      h('span', { style: { width: 34 } }, label),
                      h(
                        'span',
                        { className: 'ec-bar' },
                        h('i', { style: { width: `${Math.round(((item.missed ?? 0) / biggest) * 100)}%` } })
                      ),
                      h('span', { className: 'ec-sub' }, t('missedCount', { n: item.missed ?? 0 }))
                    )
                  })
                )
              : h('div', { className: 'ec-empty' }, t('resultWeakNone'))
          ),
          h(
            'section',
            { className: 'ec-card' },
            h(
              'button',
              {
                type: 'button',
                className: 'ec-btn ec-btn-ghost',
                onClick: () => setShowDiagnostics(!showDiagnostics)
              },
              `${showDiagnostics ? '▾' : '▸'} ${t('diagnostics')}`
            ),
            showDiagnostics
              ? h(
                  'div',
                  { style: { marginTop: 10 } },
                  (progress.curve ?? [])
                    .slice()
                    .reverse()
                    .map((point, index) =>
                      h(
                        'div',
                        { key: index, className: 'ec-muted', style: { padding: '4px 0' } },
                        `${String(point.at).slice(0, 10)}　${point.band}　${t('accuracy')} ${Math.round(
                          (point.accuracy ?? 0) * 100
                        )}%`
                      )
                    ),
                  progress.expiredDrafts
                    ? h('div', { className: 'ec-muted', style: { paddingTop: 6 } },
                        `${t('expiredDrafts')}：${progress.expiredDrafts}`)
                    : null
                )
              : null
          )
        )
      )
    }

    // -------------------------------------------------------------- assessment

    function AssessmentPanel({ onExit, onFinished }) {
      const [attempt, setAttempt] = useState(null)
      const [feedback, setFeedback] = useState(null)
      const [result, setResult] = useState(null)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const [bankJob, setBankJob] = useState(null)

      useEffect(() => {
        void (async () => {
          const resumed = await call('assessment.resume')
          if (resumed.ok && resumed.data) setAttempt(resumed.data)
        })()
      }, [])

      useEffect(() => {
        if (!bankJob || bankJob.status !== 'pending') return
        const timer = setInterval(async () => {
          const status = await call('job.status', { kind: 'assessment' })
          if (status.ok && status.data) {
            setBankJob(status.data)
            if (status.data.status !== 'pending') setNotice({ tone: 'success', text: t('bankReady') })
          }
        }, 4000)
        return () => clearInterval(timer)
      }, [bankJob])

      const start = async (kind) => {
        setBusy(true)
        setNotice(null)
        const started = await call('assessment.start', { kind })
        setBusy(false)
        if (!started.ok) {
          setNotice({
            tone: 'error',
            text: started.code === 'no_question_bank' ? t('needBank') : started.message
          })
          return
        }
        setResult(null)
        setFeedback(null)
        setAttempt(started.data)
      }

      const makeBank = async () => {
        setBusy(true)
        const started = await call('generate.assessment')
        setBusy(false)
        if (!started.ok) {
          setNotice({ tone: 'error', text: started.message })
          return
        }
        setBankJob(started.data)
        setNotice(null)
      }

      const answer = async (choice) => {
        if (!attempt || !attempt.question) return
        setBusy(true)
        const answered = await call('assessment.answer', {
          attemptId: attempt.attemptId,
          itemId: attempt.question.id,
          choice
        })
        setBusy(false)
        if (!answered.ok) {
          setNotice({ tone: 'error', text: answered.message })
          return
        }
        setFeedback({ choice, answerIndex: answered.data.answerIndex, explanation: answered.data.explanation })
        if (answered.data.done) {
          setResult(answered.data.result)
          return
        }
        setTimeout(() => {
          setFeedback(null)
          setAttempt({ ...attempt, question: answered.data.question, progress: answered.data.progress })
        }, 900)
      }

      if (result) {
        return h(
          'div',
          { className: 'ec-card' },
          h('div', { className: 'ec-stat-label' }, t('resultTitle')),
          h('div', { className: 'ec-big', style: { fontSize: 38 } }, result.band),
          h('div', { className: 'ec-muted', style: { margin: '10px 0 4px' } },
            `${t('resultRef')}：${result.reference}`),
          h('div', { className: 'ec-section-title' }, t('resultWeak')),
          (result.weaknesses ?? []).length
            ? result.weaknesses.map((weakness, index) =>
                h('div', { key: index, className: 'ec-muted' }, `· ${weakness.skill}（错 ${weakness.missed} 题）`)
              )
            : h('div', { className: 'ec-muted' }, t('resultWeakNone')),
          h(
            'div',
            { className: 'ec-row', style: { marginTop: 18 } },
            h(
              Btn,
              {
                primary: true,
                onClick: async () => {
                  await onFinished()
                  onExit()
                }
              },
              t('finish')
            )
          )
        )
      }

      if (attempt && attempt.question) {
        const question = attempt.question
        return h(
          'div',
          { className: 'ec-card' },
          h(
            'div',
            { className: 'ec-row' },
            h('span', { className: 'ec-muted' },
              t('question', { n: (attempt.progress ?? 0) + 1, total: attempt.total ?? 20 })),
            h(Btn, { ghost: true, style: { marginLeft: 'auto' }, onClick: onExit }, t('exiting'))
          ),
          h('div', { className: 'ec-progress' },
            h('i', { style: { width: `${(((attempt.progress ?? 0) + 1) / (attempt.total ?? 20)) * 100}%` } })),
          question.passage
            ? h('div', { className: 'ec-body', style: { fontSize: 14, marginBottom: 10 } }, question.passage)
            : null,
          h('div', { style: { fontSize: 14.5, marginBottom: 4 } }, question.prompt),
          h(ChoiceList, {
            choices: question.choices,
            answerIndex: feedback ? feedback.answerIndex : -1,
            picked: feedback ? feedback.choice : null,
            disabled: busy,
            onPick: answer
          }),
          feedback
            ? h(
                'div',
                { className: 'ec-feedback' },
                `${feedback.choice === feedback.answerIndex ? t('correct') : t('wrong')}　${feedback.explanation ?? ''}`
              )
            : null,
          notice ? h(Notice, { tone: notice.tone }, notice.text) : null
        )
      }

      return h(
        'div',
        { className: 'ec-card' },
        h('h2', null, t('startAssessment')),
        h('div', { className: 'ec-muted', style: { marginBottom: 14 } }, t('assessmentFirst')),
        notice ? h(Notice, { tone: notice.tone }, notice.text) : null,
        bankJob && bankJob.status === 'pending'
          ? h(Notice, null, t('makeBankRunning'))
          : null,
        h(
          'div',
          { className: 'ec-row' },
          h(Btn, { primary: true, onClick: () => void start('full'), disabled: busy }, t('fullAssessment')),
          h(Btn, { onClick: () => void start('short'), disabled: busy }, t('shortAssessment')),
          h(Btn, { ghost: true, onClick: makeBank, disabled: busy || (bankJob && bankJob.status === 'pending') },
            t('makeBank')),
          h(Btn, { ghost: true, onClick: onExit }, t('exiting'))
        )
      )
    }

    // ------------------------------------------------------------------ panel

    function Panel() {
      const [tab, setTab] = useState('today')
      const [mode, setMode] = useState('normal')
      const { data, error, loading, reload } = useRefresh(loadState, 20000)
      const words = useRefresh(loadWords, 0)

      if (loading) {
        return h('div', { className: 'ec-root' }, h(Style), h('div', { className: 'ec-wrap' },
          h('div', { className: 'ec-empty' }, t('loading'))))
      }
      if (error) {
        return h('div', { className: 'ec-root' }, h(Style), h('div', { className: 'ec-wrap' },
          h('section', { className: 'ec-card' },
            h(Notice, { tone: 'error' }, error),
            h(Btn, { onClick: reload }, t('retry')))))
      }

      if (!data.onboarded) {
        return h('div', { className: 'ec-root' }, h(Style),
          h('div', { className: 'ec-wrap', style: { maxWidth: 720 } },
            h('header', { className: 'ec-top' }, h('h1', null, t('title'))),
            h(Onboarding, { onSaved: reload })))
      }

      if (mode === 'assessment') {
        return h('div', { className: 'ec-root' }, h(Style),
          h('div', { className: 'ec-wrap', style: { maxWidth: 780 } },
            h('header', { className: 'ec-top' },
              h('h1', null, t('title')),
              h('div', { className: 'ec-status' },
                h('button', { type: 'button', onClick: () => setMode('normal') }, t('backToStudy')))),
            h(AssessmentPanel, { onExit: () => setMode('normal'), onFinished: reload })))
      }

      const due = data.review?.dueCount ?? 0
      const streak = data.streak?.current ?? 0
      const band = data.level?.latest?.band ?? null
      const tabs = [
        ['today', t('today')],
        ['words', t('words')],
        ['plan', t('plan')],
        ['progress', t('progress')]
      ]

      let content = null
      if (tab === 'todays' || tab === 'today') {
        content = h('div', { className: 'ec-page' },
          data.needsAssessment
            ? h('section', { className: 'ec-card', style: { marginBottom: 14 } },
                h('div', { className: 'ec-row' },
                  h('div', null,
                    h('div', { style: { fontSize: 13 } }, t('assessmentFirst')),
                    h('div', { className: 'ec-sub' }, t('assessmentFirstHint'))),
                  h(Btn, { primary: true, style: { marginLeft: 'auto' }, onClick: () => setMode('assessment') },
                    t('startAssessment'))))
            : null,
          h(TodayTab, { data, words, reload, reloadWords: words.reload, onTab: setTab }))
      } else if (tab === 'words') {
        // The review card keeps the same right-rail home it has on 今天, so the
        // words tab reads as "the library, plus the session you are in".
        content = h('div', { className: 'ec-grid' },
          h('div', { className: 'ec-col' }, h(Library, { words, now: data.now })),
          h('div', { className: 'ec-col' },
            h(WordDeck, {
              words,
              now: data.now,
              compact: true,
              limit: data.settings?.study?.wordsPerDay ?? 10,
              reloadWords: words.reload,
              onAnswered: async () => {
                await reload()
                await words.reload()
              }
            })))
      } else if (tab === 'plan') {
        content = h(PlanTab, { data, reload })
      } else {
        content = h(ProgressTab, { data })
      }

      return h(
        'div',
        { className: 'ec-root' },
        h(Style),
        h(
          'div',
          { className: 'ec-wrap' },
          h(
            'header',
            { className: 'ec-top' },
            h('h1', null, t('title')),
            h(
              'nav',
              { className: 'ec-seg' },
              tabs.map(([id, label]) =>
                h(
                  'button',
                  { key: id, type: 'button', 'data-on': tab === id, onClick: () => setTab(id) },
                  label
                )
              )
            ),
            h(
              'div',
              { className: 'ec-status' },
              h('span', null, `${t('dueShort')} `, h('b', null, String(due))),
              h('span', null, `${t('streakShort')} `, h('b', null, String(streak))),
              band ? h('span', null, `${t('bandShort')} `, h('b', null, band)) : null,
              h('button', { type: 'button', onClick: () => setMode('assessment') }, t('assessmentShort'))
            )
          ),
          content
        )
      )
    }

    // -------------------------------------------------------------- settings

    function SettingsPage() {
      const { data, error, reload } = useRefresh(loadState, 0)
      const [profile, setProfile] = useState(null)
      const [settings, setSettings] = useState(null)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [migrateTarget, setMigrateTarget] = useState('')

      useEffect(() => {
        if (!data) return
        setProfile(
          data.profile ?? {
            goal: 'work',
            minutesPerDay: 30,
            targetBand: '中级',
            interests: [],
            confirmedAt: null
          }
        )
        setSettings(data.settings)
      }, [data])

      if (error) return h('div', { className: 'ec-settings' }, h(Style), h(Notice, { tone: 'error' }, error))
      if (!profile || !settings) {
        return h('div', { className: 'ec-settings' }, h(Style), h('div', { className: 'ec-empty' }, t('loading')))
      }

      const saveProfile = async () => {
        setBusy(true)
        const result = await call('profile.save', {
          ...profile,
          minutesPerDay: Number(profile.minutesPerDay),
          interests: Array.isArray(profile.interests)
            ? profile.interests
            : String(profile.interests)
                .split(/[,，]/)
                .map((item) => item.trim())
                .filter(Boolean)
        })
        setBusy(false)
        setStatus(result.ok ? { tone: 'success', text: t('saved') } : { tone: 'error', text: result.message })
        if (result.ok) await reload()
      }

      const saveSettings = async (patch) => {
        const next = {
          automation: patch.automation ?? settings.automation,
          audio: patch.audio ?? settings.audio,
          study: patch.study ?? settings.study
        }
        const result = await call('settings.save', next)
        if (!result.ok) {
          setStatus({ tone: 'error', text: result.message })
          return
        }
        setSettings(result.data)
        setStatus({ tone: 'success', text: t('saved') })
        await reload()
      }

      const migrate = async () => {
        const target = migrateTarget.trim()
        if (!target) return
        setBusy(true)
        setStatus({ tone: 'info', text: t('migrating') })
        const result = await call('settings.migrateRoot', { target })
        setBusy(false)
        setStatus(
          result.ok
            ? { tone: 'success', text: `${t('dataRoot')}：${result.data.dataRoot}` }
            : { tone: 'error', text: result.message }
        )
        if (result.ok) {
          setMigrateTarget('')
          await reload()
        }
      }

      return h(
        'div',
        { className: 'ec-settings' },
        h(Style),
        status ? h(Notice, { tone: status.tone }, status.text) : null,

        h('div', { className: 'ec-section-title' }, t('editProfile')),
        h(
          Field,
          { label: t('goal') },
          h(
            'select',
            {
              className: 'ec-select',
              value: profile.goal,
              onChange: (event) => setProfile({ ...profile, goal: event.target.value })
            },
            GOALS.map((goal) =>
              h('option', { key: goal, value: goal }, t(`goal${goal[0].toUpperCase()}${goal.slice(1)}`))
            )
          )
        ),
        h(
          Field,
          { label: t('minutes') },
          h('input', {
            className: 'ec-input',
            type: 'number',
            min: 5,
            max: 180,
            value: profile.minutesPerDay,
            onChange: (event) => setProfile({ ...profile, minutesPerDay: event.target.value })
          })
        ),
        h(
          Field,
          { label: t('targetBand') },
          h(
            'select',
            {
              className: 'ec-select',
              value: profile.targetBand ?? '中级',
              onChange: (event) => setProfile({ ...profile, targetBand: event.target.value })
            },
            BANDS.map((band) => h('option', { key: band, value: band }, band))
          )
        ),
        h(
          Field,
          { label: t('interests'), hint: t('interestsHint') },
          h('input', {
            className: 'ec-input',
            type: 'text',
            value: Array.isArray(profile.interests) ? profile.interests.join(', ') : String(profile.interests ?? ''),
            onChange: (event) => setProfile({ ...profile, interests: event.target.value })
          })
        ),
        h(Btn, { primary: true, onClick: saveProfile, disabled: busy }, t('save')),

        h('div', { className: 'ec-section-title' }, t('studyPace')),
        h(
          Field,
          { label: t('wordsPerDay'), hint: t('wordsPerDayHint') },
          h('input', {
            className: 'ec-input',
            type: 'number',
            min: 3,
            max: 30,
            value: settings.study?.wordsPerDay ?? 10,
            onChange: (event) => {
              const raw = event.target.value
              setSettings({ ...settings, study: { ...(settings.study ?? {}), wordsPerDay: raw } })
            },
            onBlur: (event) => {
              const words = Number(event.target.value)
              if (!Number.isInteger(words) || words < 3 || words > 30) {
                setStatus({ tone: 'error', text: t('wordsPerDayHint') })
                setSettings({ ...settings, study: { wordsPerDay: settings.study?.wordsPerDay ?? 10 } })
                return
              }
              if (words !== (settings.study?.wordsPerDay ?? 10)) void saveSettings({ study: { wordsPerDay: words } })
            }
          })
        ),

        h('div', { className: 'ec-section-title' }, t('automation')),
        h('div', { className: 'ec-muted', style: { marginBottom: 10 } }, t('automationHint')),
        h(
          'label',
          { className: 'ec-goal' },
          h('input', {
            type: 'checkbox',
            checked: Boolean(settings.automation?.enabled),
            onChange: (event) =>
              void saveSettings({
                automation: { ...settings.automation, enabled: event.target.checked }
              })
          }),
          h('span', null, settings.automation?.enabled ? t('automationOn') : t('automationOff'))
        ),
        h(
          Field,
          { label: t('automationTime') },
          h('input', {
            className: 'ec-input',
            type: 'time',
            value: settings.automation?.time ?? '08:00',
            onChange: (event) =>
              void saveSettings({ automation: { ...settings.automation, time: event.target.value } })
          })
        ),

        h('div', { className: 'ec-section-title' }, t('audioProvider')),
        h(
          'select',
          {
            className: 'ec-select',
            value: settings.audio?.provider ?? 'web-speech',
            onChange: (event) => void saveSettings({ audio: { provider: event.target.value } })
          },
          h('option', { value: 'web-speech' }, t('audioWeb')),
          h('option', { value: 'source-audio' }, t('audioSource'))
        ),

        h('div', { className: 'ec-section-title' }, t('dataRoot')),
        h('div', { className: 'ec-muted', style: { marginBottom: 8, wordBreak: 'break-all' } },
          data.dataRoot ?? ''),
        h('div', { className: 'ec-muted', style: { marginBottom: 10 } }, t('dataRootHint')),
        h(
          'div',
          { className: 'ec-row' },
          h('input', {
            className: 'ec-input',
            type: 'text',
            style: { flex: 1 },
            placeholder: '~/Documents/English',
            value: migrateTarget,
            onChange: (event) => setMigrateTarget(event.target.value)
          }),
          h(Btn, { onClick: migrate, disabled: busy || !migrateTarget.trim() }, t('migrate'))
        ),

        h('div', { className: 'ec-section-title' }, t('regenerateSyllabus')),
        h('div', { className: 'ec-muted', style: { marginBottom: 10 } },
          '按当前档位与目标档位重写一份大纲；本周已勾选的目标会保留。'),
        h(
          Btn,
          {
            onClick: async () => {
              setBusy(true)
              const result = await call('syllabus.generate')
              setBusy(false)
              setStatus(
                result.ok
                  ? { tone: 'success', text: t('saved') }
                  : { tone: 'error', text: result.message }
              )
              if (result.ok) await reload()
            },
            disabled: busy
          },
          t('regenerateSyllabus')
        )
      )
    }

    // ---------------------------------------------------------------- overlay

    /**
     * The overlay is an entry, not a study surface: it says what is waiting and
     * drops the learner into the panel. Keeping the session in one place means
     * the box state, the explanation and the library never disagree.
     */
    function Pill({ getLayout }) {
      const { data, reload } = useRefresh(loadState, 30000)
      const [open, setOpen] = useState(false)
      const [queue, setQueue] = useState(null)

      // Where the learner dragged the pill: null means "the default corner".
      const [pos, setPosState] = useState(null)
      const positionRef = useRef(null)
      const pillRef = useRef(null)
      const dragRef = useRef(null)
      const movedRef = useRef(false)

      const applyPosition = useCallback((next) => {
        positionRef.current = next
        setPosState(next)
      }, [])

      const clampPosition = useCallback((x, y, width, height) => {
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
        const maxX = Math.max(8, viewportWidth - width - 8)
        const maxY = Math.max(8, viewportHeight - height - 8)
        return {
          x: Math.round(Math.min(Math.max(8, x), maxX)),
          y: Math.round(Math.min(Math.max(8, y), maxY))
        }
      }, [])

      useEffect(() => {
        let saved = null
        try {
          saved = JSON.parse(window.localStorage.getItem(PILL_POSITION_KEY) ?? 'null')
        } catch {
          return
        }
        if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return
        const box = pillRef.current?.getBoundingClientRect()
        applyPosition(clampPosition(saved.x, saved.y, box?.width ?? 130, box?.height ?? 38))
      }, [applyPosition, clampPosition])

      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onResize = () => {
          const current = positionRef.current
          const box = pillRef.current?.getBoundingClientRect?.()
          if (!current || !box) return
          applyPosition(clampPosition(current.x, current.y, box.width, box.height))
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [applyPosition, clampPosition])

      const persistPosition = (value) => {
        try {
          window.localStorage.setItem(PILL_POSITION_KEY, JSON.stringify(value))
        } catch {
          /* storage may be unavailable; the position still holds this session */
        }
      }

      const onPointerDown = (event) => {
        if (event.button !== undefined && event.button > 0) return
        const box = event.currentTarget.getBoundingClientRect()
        dragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          originX: pos ? pos.x : box.left,
          originY: pos ? pos.y : box.top,
          width: box.width,
          height: box.height
        }
        movedRef.current = false
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* capture is a nicety; dragging still works without it */
        }
      }

      const onPointerMove = (event) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (!movedRef.current && Math.abs(dx) + Math.abs(dy) < 5) return
        movedRef.current = true
        applyPosition(clampPosition(drag.originX + dx, drag.originY + dy, drag.width, drag.height))
      }

      const onPointerUp = (event) => {
        const drag = dragRef.current
        dragRef.current = null
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* already released */
        }
        if (drag && movedRef.current && positionRef.current) persistPosition(positionRef.current)
      }

      useEffect(() => {
        void (async () => {
          const result = await call('review.list')
          if (result.ok) setQueue(result.data)
        })()
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      const dueCount = queue?.dueCount ?? data?.review?.dueCount ?? 0
      const first = (queue?.items ?? []).find((item) => item.due) ?? null
      const lesson = data?.todayLesson
      const hasDraft = lesson && lesson.status === 'draft'
      const badge = dueCount > 0 ? dueCount : hasDraft ? '·' : ''

      const openPanel = () => {
        // Resolved at click time: on a cold boot the layout service may not
        // have existed when this component was registered.
        try {
          const layout = typeof getLayout === 'function' ? getLayout() : null
          if (layout && layout.selectPanel) layout.selectPanel('english-coach')
        } catch {
          /* the panel entry may be gone */
        }
        if (!dueCount) for (const start of vocabRequests) start()
        setOpen(false)
      }

      const openDown = Boolean(pos && pos.y < 280)
      const pillStyle = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined

      let hint = ''
      if (dueCount) hint = first ? t('pillHint') : t('nothingDue')
      else if (hasDraft) hint = t('draftReady')
      else if (queue?.nextDueAt) hint = t('nextDueContinue', { date: formatDay(queue.nextDueAt) })
      else hint = t('continueHint')

      return h(
        'div',
        { className: 'ec-overlay-layer' },
        h(Style),
        h(
          'div',
          { className: 'ec-pill', ref: pillRef, style: pillStyle },
          open
            ? h(
                'div',
                { className: 'ec-pop', 'data-down': openDown },
                h(
                  'div',
                  { className: 'ec-pop-head' },
                  h('b', null, t('title')),
                  h('span', null, dueCount ? t('dueToday', { n: dueCount }) : t('nothingDueShort'))
                ),
                first ? h('div', { className: 'ec-pop-term' }, first.term) : null,
                h('div', { className: 'ec-pop-hint' }, hint),
                h(
                  'div',
                  { className: 'ec-pop-acts' },
                  h(Btn, { primary: true, onClick: openPanel }, dueCount ? t('studyInPanel') : t('continueLearning')),
                  h(Btn, { ghost: true, onClick: () => setOpen(false) }, t('collapse'))
                )
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'ec-pill-btn',
              title: t('dragHint'),
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel: onPointerUp,
              onClick: () => {
                if (movedRef.current) {
                  movedRef.current = false
                  return
                }
                setOpen(!open)
                if (!open) void reload()
              }
            },
            h(
              'svg',
              { width: 15, height: 15, viewBox: '0 0 24 24', 'aria-hidden': true },
              h('path', {
                d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v11.5a2.5 2.5 0 0 0-2.5-2.5H4z',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.7,
                strokeLinejoin: 'round'
              }),
              h('path', {
                d: 'M6.5 22A2.5 2.5 0 0 0 9 19.5h11',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.7,
                strokeLinecap: 'round'
              })
            ),
            h('span', null, t('title')),
            badge ? h('span', { className: 'ec-pill-count' }, String(badge)) : null
          )
        )
      )
    }

    // ------------------------------------------------------------- sidebar icon

    function SidebarIcon({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 20
      return h(
        'svg',
        { width: edge, height: edge, viewBox: '0 0 64 64', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 2, y: 2, width: 60, height: 60, rx: 16, fill: 'currentColor', opacity: 0.14 }),
        h('path', {
          d: 'M15 24.5c0-1.4 1.1-2.5 2.5-2.5H30c1.1 0 2 .9 2 2v24c0-2.2-1.8-3.4-4-3.4H17.5c-1.4 0-2.5-1.1-2.5-2.5z',
          fill: 'currentColor'
        }),
        h('path', {
          d: 'M49 24.5c0-1.4-1.1-2.5-2.5-2.5H34c-1.1 0-2 .9-2 2v24c0-2.2 1.8-3.4 4-3.4h10.5c1.4 0 2.5-1.1 2.5-2.5z',
          fill: 'currentColor',
          opacity: 0.6
        }),
        h('path', {
          d: 'M24 33.5 30 27.5l3.5 3.5L43 22',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 3.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        })
      )
    }

    // ------------------------------------------------------------------- apply

    return {
      inject: ['slots'],
      apply(ctx) {
        const Overlay = () => h(Pill, { getLayout: () => ctx.get('layout') })

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'english-coach',
              order: 20,
              label: () => t('title')
            },
            SidebarIcon
          )
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'english-coach' }, Panel)
        )

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'english-coach',
              order: 30,
              label: () => t('title')
            },
            SettingsPage
          )
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'english-coach', order: 60 },
            Overlay
          )
        )
      }
    }
  }
})

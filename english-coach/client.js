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
      speechSettings: '朗读设置',
      today: '今日',
      plan: '计划',
      progress: '进度',
      profile: '个人',
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
      profileTitle: '个人目标',
      profileHint: '用于安排学习目标和选择课程素材，随时可以改。',
      profileInterestsHint: '输入主题后按回车或点「添加」，最多 12 个；最后点「保存」。',
      interestLimit: '最多填写 12 个兴趣主题，请先移除一些再添加。',
      goalNote: '为什么学英语',
      goalNotePlaceholder: '例如：评审会上要听懂对方的技术判断',
      interestAdd: '加一个，回车确认',
      removeInterest: '移除',
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
      dueReview: '单词学习',
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
      profileSettingsNote: '画像、目标和兴趣在「个人」页里改。',
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
      reviewDone: '这一批学完了',
      reviewDoneHint: '这批答对 {n} 个。复习排期已按作答更新，还可以继续下一批。',
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
      studyInPanel: '打开主页',
      pillProgress: '第 {i} 个 / 共 {n} 个',

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
      wordsPerDay: '每批学习 / 每次补充词数',
      wordsPerDayHint: '3 到 30 个，默认 10 个。课程建议出词量也用这个数；不是每日上限，可同日继续学习。',
      continueLearning: '继续学习',
      continueLearningHint: '下一批最多 {n} 个，先复习旧词；词库新词可直接学习。',
      generatingWords: '正在出词…',
      generatingWordsHint: '正在出词，大约一分钟；出好后会自动接着学。',
      continueReview: '继续复习剩下的 {n} 个',
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
    // 悬浮层和面板答的是同一个复习队列：任何一边答完，另一边都重读一次，
    // 免得面板上还挂着已经被答掉的词。
    const homeListeners = new Set()
    const reviewListeners = new Set()
    const settingsListeners = new Set()
    const notifyReview = () => {
      for (const listener of reviewListeners) listener()
    }

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
        const result = await response.json()
        if (result.ok && ['settings.save', 'wordlists.select'].includes(command)) {
          for (const listener of settingsListeners) listener()
        }
        return result
      } catch {
        return { ok: false, code: 'bad_response', message: '插件后台返回了无法解析的内容' }
      }
    }

    // --------------------------------------------------------------- audio

    // One sound owner for every entry point. Keep this inside the Client factory:
    // the Host loads this plain script, not an independently bundled ES module.
    const speech = (() => {
      const articles = new Map(), listeners = new Set()
      let bookmarkWrites = Promise.resolve()
      // Two independent 32-bit streams plus length: stable synchronous content
      // fingerprint, not a security hash and never sent with the actual text.
      function fingerprint(text) {
        let a = 2166136261, b = 5381
        for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i) }
        return `s1-${text.length}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`
      }
      function save(value) {
        value.revision++
        const revision = value.revision
        const payload = { materialId: value.id, contentFingerprint: value.fingerprint, position: value.position }
        bookmarkWrites = bookmarkWrites.then(async () => {
          if (articles.get(value.id) !== value) return
          const result = await call('audio.bookmark.save', payload)
          if (revision !== value.revision || articles.get(value.id) !== value) return
          value.saveError = result.ok ? '' : '书签保存失败，当前会话位置仍保留。'
          emit()
        })
        return bookmarkWrites
      }
      async function restore(value) {
        if (value.loaded) return
        value.loaded = true
        const revision = value.revision
        const result = await call('audio.bookmark.get', { materialId: value.id, contentFingerprint: value.fingerprint })
        if (revision !== value.revision || articles.get(value.id) !== value) return
        if (!result.ok) value.saveError = '无法读取书签；当前会话仍可定位，请重试读取书签。'
        else if (result.data.invalidated) value.notice = '正文已变化，旧书签已失效，已静默回到起点。'
        else if (result.data.bookmark) {
          value.position = Math.min(value.segments.length, Math.max(0, result.data.bookmark.position))
          value.status = value.position === value.segments.length ? 'completed' : value.position > 0 ? 'paused' : 'idle'
          value.notice = '已静默恢复书签，请手动继续。'
        }
        emit()
      }
      let active = null, token = 0, loaded = false, settingsWrites = Promise.resolve()
      const changedPreferences = new Set()
      const preferences = { voiceURI: null, rate: 1, voices: [], notice: '', error: '' }
      function refreshVoices() {
        try { preferences.voices = (synth()?.getVoices() ?? []).filter(voice => /^en(?:[-_]|$)/i.test(voice.lang)) } catch { preferences.voices = [] }
        if (active && !preferences.voices.some(voice => voice.voiceURI === active.utterance.voice?.voiceURI)) {
          const current = active.article
          cancel()
          if (current) { current.status = 'error'; current.error = '正在使用的英语音色已不可用，请换声后重试。'; void save(current) }
          else preferences.error = '正在使用的英语音色已不可用，请换声后重试。'
        }
        preferences.notice = !available() ? t('noSpeech') : !preferences.voices.length ? '英语音色尚未就绪或不可用，请重试声源。' : preferences.voiceURI && !preferences.voices.some(voice => voice.voiceURI === preferences.voiceURI) ? '偏好音色当前不可用，已回退到可用英语音色。' : ''
        emit()
      }
      const selectedVoice = () => preferences.voices.find(voice => voice.voiceURI === preferences.voiceURI) ?? preferences.voices.find(voice => voice.default) ?? preferences.voices[0]
      async function loadPreferences() {
        if (loaded) return
        loaded = true
        const result = await call('settings.get')
        if (result.ok) {
          if (!changedPreferences.has('voiceURI')) preferences.voiceURI = result.data.audio?.voiceURI ?? null
          if (!changedPreferences.has('rate')) preferences.rate = [0.5, 1, 1.5, 2].includes(result.data.audio?.rate) ? result.data.audio.rate : 1
        } else preferences.error = '无法读取语音偏好，暂用默认设置。'
        refreshVoices()
      }
      function configure(change) {
        for (const key of Object.keys(change)) changedPreferences.add(key)
        Object.assign(preferences, change)
        const current = active?.article
        const playing = current?.status === 'playing'
        if (current) { cancel(); if (playing) play(current) }
        refreshVoices()
        const payload = { audio: { ...change } }
        settingsWrites = settingsWrites.then(async () => {
          const result = await call('settings.save', payload)
          preferences.error = result.ok ? '' : '语音偏好保存失败，请重新选择后重试。'
          emit()
        })
      }
      const synth = () => window.speechSynthesis
      const emit = () => { for (const listener of listeners) listener() }
      const available = () => !!(synth() && window.SpeechSynthesisUtterance)
      let resumeTimer = null
      const clearResume = () => { if (resumeTimer !== null) { clearTimeout(resumeTimer); resumeTimer = null } }
      const cancel = () => { clearResume(); token++; active = null; if (available()) { try { synth().cancel() } catch { /* unavailable Host */ } } }
      function article(id, text) {
        const previous = articles.get(id)
        if (previous?.text === text) return previous
        if (active?.article === previous) cancel()
        const value = { id, text, segments: (text.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? []).map(s => s.trim()).filter(Boolean), position: 0, status: 'idle', error: '', fingerprint: fingerprint(text), revision: 0, loaded: false, notice: previous ? '正文已变化，旧书签已失效，已静默回到起点。' : '', saveError: '' }
        articles.set(id, value)
        return value
      }
      function pause(value) {
        if (value.status !== 'playing') return
        value.status = 'paused'
        clearResume()
        void save(value)
        if (active?.article === value) {
          try { synth().pause(); if (!synth().paused) cancel() } catch { cancel() }
        }
        emit()
      }
      function play(value) {
        if (!available()) { value.status = 'error'; value.error = t('noSpeech'); emit(); return }
        if (!selectedVoice()) { value.status = 'error'; value.error = '暂无可用英语音色，请重试声源。'; emit(); return }
        if (!value.segments.length) return
        if (active?.article === value && value.status === 'paused') {
          // A bounded liveness check, never a progress clock. Some engines
          // accept resume but emit neither resume nor boundary and stay silent.
          const run = token
          value.status = 'playing'
          resumeTimer = setTimeout(() => {
            resumeTimer = null
            if (run !== token || value.status !== 'playing') return
            cancel(); value.status = 'paused'; play(value)
          }, 700)
          try { synth().resume(); if (!synth().paused && synth().speaking) { emit(); return } } catch { /* rebuild the saved segment */ }
          clearResume()
        }
        if (active?.article && active.article !== value) pause(active.article)
        cancel()
        const run = token
        value.error = ''
        value.status = 'playing'
        void save(value)
        const utterance = new window.SpeechSynthesisUtterance(value.segments[value.position])
        utterance.voice = selectedVoice()
        utterance.lang = utterance.voice.lang
        utterance.rate = preferences.rate
        active = { article: value, utterance }
        utterance.onresume = utterance.onboundary = () => { if (run === token && value.status === 'playing') clearResume() }
        utterance.onend = () => {
          if (run !== token) return
          if (value.status !== 'playing') { cancel(); return }
          clearResume()
          active = null
          value.position++
          void save(value)
          if (value.position >= value.segments.length) { value.status = 'completed'; emit() }
          else play(value)
        }
        utterance.onerror = () => {
          if (run !== token) return
          cancel(); value.status = 'error'; value.error = '朗读失败，请重试或更换英语音色。'; emit()
        }
        try { if (synth().paused) synth().resume(); synth().speak(utterance) } catch { utterance.onerror() }
        emit()
      }
      function seek(value, position) {
        const playing = value.status === 'playing'
        if (active?.article === value) cancel()
        value.position = Math.max(0, Math.min(value.segments.length, Number(position) || 0))
        value.status = value.position === value.segments.length ? 'completed' : value.status === 'idle' ? 'idle' : 'paused'
        void save(value)
        if (playing && value.position < value.segments.length) play(value)
        else emit()
      }
      function restart(value) { cancel(); value.position = 0; value.status = 'idle'; play(value) }
      function short(text, owner) {
        if (active?.article) pause(active.article)
        cancel()
        if (!available() || !selectedVoice()) { preferences.error = '暂无可用英语音色，请重试声源。'; emit(); return }
        preferences.error = ''
        const run = token, utterance = new window.SpeechSynthesisUtterance(text)
        utterance.voice = selectedVoice(); utterance.lang = utterance.voice.lang; utterance.rate = preferences.rate
        active = { owner, utterance }
        utterance.onend = () => { if (run !== token) return; active = null; emit() }
        utterance.onerror = () => { if (run !== token) return; cancel(); preferences.error = '发音失败，请重试或更换英语音色。'; emit() }
        try { if (synth().paused) synth().resume(); synth().speak(utterance) } catch { utterance.onerror() }
        emit()
      }
      function suspend() { if (active?.article) pause(active.article); else if (active) cancel() }
      const hidden = () => { if (document.hidden) suspend() }
      return { article, pause, play, restart, seek, save, restore, preferences, configure, selectedVoice, refreshVoices, short,
        release(owner) { if (active?.owner === owner) cancel() },
        subscribe(listener) {
          listeners.add(listener)
          if (listeners.size === 1) { refreshVoices(); synth()?.addEventListener?.('voiceschanged', refreshVoices); document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', suspend); void loadPreferences() }
          return () => { listeners.delete(listener); if (!listeners.size) { synth()?.removeEventListener?.('voiceschanged', refreshVoices); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', suspend); suspend(); cancel() } }
        }
      }
    })()
    function useSpeech() {
      const [, update] = useState(0)
      useEffect(() => speech.subscribe(() => update(value => value + 1)), [])
      return speech
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
/* 个人页的三列表单：目标、时长、档位一排，备注和兴趣占满整行 */
.ec-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
.ec-form .ec-field { margin-bottom: 0; }
.ec-form .ec-wide { grid-column: 1 / -1; }
@media (max-width: 760px) { .ec-form { grid-template-columns: 1fr; } }
.ec-chip.ec-chip-edit { padding-right: 3px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.ec-chip-x { border: 0; background: none; padding: 0 4px; font: inherit; font-size: 13px; line-height: 1;
  color: var(--dsw-alias-label-secondary); cursor: pointer; }
.ec-chip-x:hover { color: var(--dsw-alias-state-error-primary); }
.ec-chip-input { flex: 1 1 140px; min-width: 140px; font: inherit; font-size: 12px; padding: 4px 10px;
  border-radius: 999px; border: 1px dashed var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-primary); }
.ec-chip-input:focus { outline: none; border-style: solid; border-color: var(--dsw-alias-brand-primary); }
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

/* Shared speech controls remain usable in a narrow panel and with a keyboard. */
.ec-term-line { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; overflow-wrap: anywhere; }
.ec-term-line > .ec-deck-term, .ec-term-line > .ec-pop-term { min-width: 0; }
.ec-pronounce { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; max-width: 100%; vertical-align: middle; }
.ec-pronounce-icon { display: inline-grid; place-items: center; flex: none; width: 32px; height: 32px;
  padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.ec-pronounce-icon:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ec-pronounce-error { font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--dsw-alias-state-error-primary); }
.ec-flash-toggle { appearance: none; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.ec-flash-toggle > span { display: block; }
.ec-flash-toggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.ec-speech-options { min-width: 0; }
.ec-speech-options > .ec-card-head { margin-bottom: 12px; }
.ec-speech-options > .ec-row { align-items: flex-end; }
.ec-speech-options > .ec-row > label { display: flex; flex-direction: column; gap: 6px; flex: 1 1 140px; min-width: 0;
  font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ec-speech-options select { width: 100%; min-width: 0; max-width: 100%; }
.ec-speech-options > [role=status], .ec-speech-options > .ec-notice { margin-top: 10px; }
.ec-pronounce button:focus-visible, .ec-speech-options select:focus-visible,
.ec-speech-options button:focus-visible, .ec-root input[type=range]:focus-visible,
.ec-item-body .ec-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

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

.ec-browse-gates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
.ec-browse-gate { display: flex; flex-direction: column; gap: 3px; padding: 16px 18px; min-width: 0;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; font: inherit; color: inherit;
  background: transparent; cursor: pointer; text-align: left; overflow-wrap: anywhere; }
.ec-browse-gate span { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ec-browse-gate[aria-expanded=true] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.ec-library { min-width: 0; overflow-wrap: anywhere; }
.ec-library .ec-card-head { flex-wrap: wrap; }
.ec-library .ec-lib-row { flex-wrap: wrap; min-height: 44px; }
.ec-library .ec-lib-row .ec-sub { min-width: 0; overflow-wrap: anywhere; }
.ec-library .ec-lib-term { overflow-wrap: anywhere; }
.ec-library .ec-modal { box-sizing: border-box; overflow-wrap: anywhere; }
.ec-library .ec-card select { width: auto; max-width: 100%; }
@media (max-width: 480px) { .ec-browse-gates { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .ec-library > .ec-card { padding: 16px; } .ec-library .ec-card-head .ec-sub { margin-left: 0; } }

/* A: a readable study surface first; browsing and preferences stay secondary. */
.ec-words-page { min-width: 0; container-type: inline-size; }
.ec-study-focus { display: grid; grid-template-columns: minmax(0, 1fr) 228px; gap: 24px; align-items: start; margin-bottom: 22px; }
.ec-study-focus > .ec-card { padding: 24px 28px; min-width: 0; }
.ec-study-focus .ec-deck-term { font-size: clamp(30px, 4vw, 42px); overflow-wrap: anywhere; }
.ec-study-focus .ec-choice { min-height: 44px; padding: 12px 14px; overflow-wrap: anywhere; }
.ec-study-arrangement { padding: 14px 0; min-width: 0; overflow-wrap: anywhere; }
.ec-study-arrangement h2 { font-size: 13px; margin: 0; font-weight: 600; }
.ec-study-arrangement p { margin: 9px 0; }
.ec-words-page button:focus-visible, .ec-words-page input:focus-visible, .ec-words-page select:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }
.ec-study-focus .ec-acts { flex-wrap: wrap; }
@container (max-width: 700px) { .ec-study-focus { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .ec-study-focus > .ec-card { padding: 20px; } }
@media (max-width: 700px) { .ec-study-focus { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
@media (max-width: 480px) { .ec-wrap { padding: 18px 14px 70px; } .ec-top { gap: 10px; }
  .ec-status { margin-left: 0; gap: 12px; flex-wrap: wrap; } .ec-seg button { padding: 7px 10px; }
  .ec-study-focus > .ec-card { padding: 18px 16px; } }
@media (prefers-reduced-motion: reduce) { .ec-words-page *, .ec-profile-page * { transition: none; } }

/* --------------------------------------------------------------- flash card */
.ec-flash { display: block; width: 100%; text-align: left; border: 0; border-top: 1px dashed var(--dsw-alias-border-l1);
  background: none; padding: 8px 0; font: inherit; color: inherit; }
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

/* A profile: the saved goal is primary; estimate and intention remain distinct. */
.ec-profile-page { max-width: 940px; }
.ec-profile-goal { padding: 24px 28px; overflow-wrap: anywhere; }
.ec-profile-page-editing { max-width: 740px; margin: 0 auto; }
.ec-profile-page-editing .ec-form { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-top: 24px; }
.ec-profile-page-editing .ec-wide { grid-column: 1 / -1; }
.ec-profile-page .ec-input, .ec-profile-page .ec-select { min-width: 0; }
.ec-profile-note-input { resize: vertical; min-height: 96px; }
.ec-profile-page button:focus-visible, .ec-profile-page input:focus-visible, .ec-profile-page select:focus-visible, .ec-profile-page textarea:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }
.ec-profile-suggestion { color: var(--dsw-alias-label-secondary); font-size: 12.5px; margin: 18px 0 0; line-height: 1.8; }
.ec-profile-read-error { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px 16px; margin-bottom: 14px; font-size: 12.5px; }
.ec-profile-read-error p { color: var(--dsw-alias-state-error-primary); margin: 0 0 8px; }
@media (max-width: 600px) { .ec-profile-goal { padding: 20px; } .ec-profile-page-editing .ec-form { grid-template-columns: minmax(0, 1fr); gap: 16px; } }

.ec-profile-comparison { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 18px; padding-top: 16px;
  border-top: 1px solid var(--dsw-alias-border-l1); }
.ec-profile-comparison > div { display: grid; gap: 3px; min-width: 100px; }
.ec-profile-comparison span { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ec-profile-comparison b { font-size: 21px; font-weight: 600; }
.ec-profile-goal-note { font-size: 20px; line-height: 1.65; margin: 12px 0; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 65ch; }
.ec-profile-link { display: inline-block; border: 0; background: transparent; color: var(--dsw-alias-brand-primary); font: inherit;
  padding: 8px 0; min-height: 36px; cursor: pointer; text-align: left; }
.ec-profile-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; border-radius: 3px; }

.ec-profile-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ec-profile-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin: 18px 0 0; }
.ec-profile-metrics dd { margin: 0; font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ec-profile-metrics dt { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 3px; }
.ec-profile-records { margin-top: 16px; min-width: 0; overflow-wrap: anywhere; }
.ec-profile-detail-facts { display: flex; flex-wrap: wrap; gap: 20px 36px; margin: 20px 0; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1); }
.ec-profile-detail-facts dt { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ec-profile-detail-facts dd { margin: 2px 0 0; font-size: 15px; }
.ec-profile-detail-heading { font-size: 13px; margin: 20px 0 6px; }
.ec-profile-weaknesses { padding-left: 20px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.ec-profile-diagnostics { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ec-profile-diagnostics p { margin: 6px 0; }
@media (max-width: 480px) { .ec-profile-metrics { gap: 12px; } .ec-profile-metrics dd { font-size: 21px; } .ec-profile-goal-note { font-size: 18px; } }

.ec-curve-wrap { margin-top: 18px; min-width: 0; }
.ec-curve-scroll { overflow-x: auto; max-width: 100%; }
.ec-curve-chart { display: block; width: 100%; min-width: 420px; height: auto; }
.ec-curve-label { fill: var(--dsw-alias-label-secondary); font-size: 12px; font-family: inherit; }
.ec-curve-grid { stroke: var(--dsw-alias-border-l1); stroke-width: 1; }
.ec-curve-line { stroke: var(--dsw-alias-brand-primary); stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
.ec-curve-point { fill: var(--dsw-alias-brand-primary); }
.ec-curve-records { list-style: none; padding: 0; margin: 10px 0; max-height: 300px; overflow: auto; }
.ec-curve-records li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px 16px; padding: 11px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 12px; }
.ec-curve-records time, .ec-curve-records span { color: var(--dsw-alias-label-secondary); }
.ec-curve-records time { flex: 1 1 160px; }
.ec-curve-records strong { font-weight: 600; }

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
.ec-pop .ec-term-line { margin: 12px 0 2px; }
.ec-pop-term { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  font-size: 24px; letter-spacing: -.01em; }
.ec-pop-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.6; margin-top: 6px; }
.ec-pop-prompt { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-top: 3px; }
/* 306px 的悬浮层里，选项比面板里紧一档，四行释义一屏放得下 */
.ec-pop .ec-choices { margin: 12px 0 0; gap: 6px; }
.ec-pop .ec-choice { font-size: 12.8px; padding: 8px 9px; gap: 8px; }
.ec-pop .ec-fb { margin-top: 12px; }
.ec-pop .ec-acts { margin-top: 10px; }
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

    function SpeechOptions() {
      const audio = useSpeech(), prefs = audio.preferences
      return h('section', { className: 'ec-card ec-speech-options', 'aria-label': t('speechSettings') },
        h('div', { className: 'ec-card-head' }, h('h2', null, t('speechSettings'))),
        h('div', { className: 'ec-row' },
          h('label', null, '英语音色', h('select', { className: 'ec-select', 'aria-label': '英语音色', value: audio.selectedVoice()?.voiceURI ?? '', onChange: event => audio.configure({ voiceURI: event.target.value }) },
            !prefs.voices.length ? h('option', { value: '' }, '暂无英语音色') : null,
            prefs.voices.map(voice => h('option', { key: voice.voiceURI, value: voice.voiceURI }, `${voice.name} · ${voice.localService ? '本地' : '联网'}`)))),
          h('label', null, '朗读语速', h('select', { className: 'ec-select', 'aria-label': '朗读语速', value: prefs.rate, onChange: event => audio.configure({ rate: Number(event.target.value) }) },
            [0.5, 1, 1.5, 2].map(rate => h('option', { key: rate, value: rate }, `${rate.toFixed(1)} 倍`)))),
          h(Btn, { small: true, onClick: () => audio.short('Hello. Let us practise English together.', 'audition') }, '试听音色'),
          h(Btn, { small: true, onClick: audio.refreshVoices }, '重试声源')),
        prefs.notice ? h('div', { role: 'status', className: 'ec-muted' }, prefs.notice) : null,
        prefs.error ? h(Notice, { tone: 'error' }, prefs.error) : null)
    }

    function PronounceButton({ text, label }) {
      const audio = useSpeech(), owner = useRef({})
      useEffect(() => () => audio.release(owner.current), [])
      if (typeof text !== 'string' || !/[A-Za-z]/.test(text) || /[\u3400-\u9fff]/.test(text)) return null
      return h('span', { className: 'ec-pronounce', onKeyDown: event => { if (['Enter', ' ', '1', '2', '3', '4'].includes(event.key)) event.stopPropagation() }, onClick: event => event.stopPropagation() },
        h('button', { type: 'button', className: 'ec-pronounce-icon', 'aria-label': label ?? `朗读 ${text}`, title: label ?? `朗读 ${text}`, onClick: event => { event.stopPropagation(); audio.short(text, owner.current) } },
          h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false },
            h('path', { d: 'M11 5 6 9H3v6h3l5 4V5Z' }),
            h('path', { d: 'M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14' }))),
        audio.preferences.error ? h('span', { className: 'ec-pronounce-error', role: 'status' }, audio.preferences.error) : null)
    }

    function Speak({ text = '', materialId }) {
      const audio = useSpeech()
      const article = useMemo(() => audio.article(materialId, text), [materialId, text])
      useEffect(() => { void audio.restore(article); return () => audio.pause(article) }, [article])
      const status = { idle: '待播放', playing: '播放中', paused: '已暂停', completed: '朗读已完成', error: '朗读错误' }[article.status]
      return h('div', { style: { margin: '10px 0' } },
        h('div', { className: 'ec-row' },
          h('span', { role: 'status' }, status),
          h(Btn, { disabled: !text.trim() || article.status === 'playing' || article.status === 'completed', onClick: () => audio.play(article) }, article.status === 'paused' ? '继续' : article.status === 'error' ? '重试朗读' : '播放'),
          h(Btn, { disabled: article.status !== 'playing', onClick: () => audio.pause(article) }, '暂停'),
          h(Btn, { disabled: !text.trim(), onClick: () => audio.restart(article) }, '从头播放')),
        h('label', { className: 'ec-label' }, `文本进度：${article.position} / ${article.segments.length} 句段`,
          h('input', { type: 'range', min: 0, max: article.segments.length, step: 1, value: article.position, 'aria-label': '文本进度', disabled: !article.segments.length, style: { width: '100%' }, onChange: event => audio.seek(article, event.target.value) })),
        article.notice ? h('div', { className: 'ec-muted', role: 'status' }, article.notice) : null,
        article.saveError ? h(Notice, { tone: 'error' }, article.saveError,
          h(Btn, { small: true, onClick: () => audio.save(article) }, '重试保存书签'),
          h(Btn, { small: true, onClick: () => { article.loaded = false; void audio.restore(article) } }, '重试读取书签')) : null,
        article.error ? h(Notice, { tone: 'error' }, article.error) : null)
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
        h(Speak, { text: item.body, materialId: `${lesson.date}:${item.id}` }),
        h('div', { className: 'ec-body' }, item.body),
        h(SourceLine, { source })
      )
    }

    function ListeningItem({ item, lesson, provider }) {
      const source = (lesson.sources ?? []).find((candidate) => candidate.id === item.sourceId)
      return h(
        'div',
        null,
        h(Speak, { text: item.transcript, materialId: `${lesson.date}:${item.id}` }),
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
            h('div', { className: 'ec-term-line', style: { fontSize: 14.5, fontWeight: 600 } },
              h('span', null, expression.term), h(PronounceButton, { text: expression.term })),
            expression.example
              ? h('div', { className: 'ec-body', style: { fontSize: 13.5, marginTop: 4 } }, expression.example,
                  h(PronounceButton, { text: expression.example, label: `朗读例句 ${expression.example}` }))
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
      // 按自然日算：明天早上的词，今天看就该是"明天"，不是"2 天后"
      const startOfDay = (value) => {
        const date = new Date(value)
        return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      }
      const days = Math.round((startOfDay(item.dueAt) - startOfDay(nowIso)) / 86400000)
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
                return h('div', { key: card.id, className: 'ec-flash', 'data-open': revealed },
                  h('div', { className: 'ec-term-line' },
                    h('button', {
                      type: 'button', className: 'ec-flash-toggle', 'aria-expanded': revealed,
                      onClick: () => setOpenCards({ ...openCards, [card.id]: !revealed })
                    },
                    h('span', { className: 'ec-flash-front' }, card.front)),
                    h(PronounceButton, { text: card.front })),
                  !revealed ? h('div', { className: 'ec-flash-hint' }, t('tapAnswer')) : null,
                  revealed ? h('div', { className: 'ec-flash-back' }, card.back,
                    card.explanation ? h('div', { className: 'ec-muted' }, card.explanation) : null) : null)
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
            { ghost: true, small: true, style: { marginLeft: 'auto' }, onClick: () => onTab('profile') },
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
    function batchNotice(batch) {
      if (!batch) return ''
      const reasons = { all_joined: '当前词库全部已加入；已加入不等于已掌握。', unavailable: '当前词库剩余词条暂不可练。', all_mastered: '当前词库已全部掌握；到期抽检仍会优先安排。' }
      const reason = reasons[batch.exhaustion] ?? (batch.mode === 'profile_required' ? '尚未指定当前词库，可选择词库或按画像补词。' : '')
      const count = batch.shortfall > 0 ? `本批取得 ${batch.items?.length ?? 0} / ${batch.batchSize} 项。` : ''
      return `${count}${reason}`
    }

    function WordDeck({ words, now, compact, limit = 10, reloadWords, onAnswered, onGoWords, onChooseList }) {
      const [ids, setIds] = useState(null)
      const [batch, setBatch] = useState(null)
      const [batchRetry, setBatchRetry] = useState(0)
      const [conflict, setConflict] = useState(false)
      const requestLock = useRef(false)
      const answerLock = useRef(false)
      const [index, setIndex] = useState(0)
      const [picked, setPicked] = useState(null)
      const [feedback, setFeedback] = useState(null)
      const [correct, setCorrect] = useState(0)
      const [answered, setAnswered] = useState(0)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [job, setJob] = useState(null)

      const begin = (list) => {
        setBatch(list)
        setConflict(false)
        setIds(list?.items ?? [])
        setIndex(0)
        setPicked(null)
        setFeedback(null)
        setCorrect(0)
        setAnswered(0)
        setError(null)
      }

      useEffect(() => {
        let alive = true
        setError(null)
        void call('study.batch').then((result) => {
          if (!alive) return
          if (result.ok) begin(result.data)
          else setError(result.message)
        })
        return () => { alive = false }
      }, [batchRetry])

      const word = ids?.[index] ?? null
      const finished = ids !== null && ids.length > 0 && index >= ids.length
      const isLast = ids !== null && index + 1 >= ids.length
      const dueLeft = words?.data?.dueCount ?? 0
      const generating = job?.status === 'pending'

      const answer = async (choice) => {
        if (!word || picked !== null || busy || answerLock.current || conflict) return
        answerLock.current = true
        setPicked(choice)
        setBusy(true)
        setError(null)
        const result = await call('review.answer', { itemId: word.id, choice })
        answerLock.current = false
        setBusy(false)
        if (!result.ok) {
          setPicked(null)
          setFeedback(null)
          setConflict(result.code === 'not_due')
          setError(result.message)
          return
        }
        if (result.data.correct) setCorrect((value) => value + 1)
        setAnswered((value) => value + 1)
        setFeedback({ correct: result.data.correct, explanation: result.data.explanation ?? word.explanation })
        if (onAnswered) void onAnswered()
      }

      const next = () => {
        setPicked(null)
        setFeedback(null)
        setConflict(false)
        setError(null)
        setIndex((value) => value + 1)
      }

      const generateMore = async (profile = false) => {
        if (requestLock.current || generating) return
        requestLock.current = true
        setBusy(true)
        setError(null)
        const result = await call(profile === true ? 'generate.vocab' : 'study.supplement', profile === true ? { profile: true } : {})
        requestLock.current = false
        setBusy(false)
        if (!result.ok) { setError(result.message); return }
        if (result.data.mode === 'generated') setJob(result.data)
        else begin(result.data)
        if (reloadWords) void reloadWords()
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
          const fresh = await call('study.batch')
          if (fresh.ok) {
            begin(fresh.data)
            if (!fresh.data.items?.length) setError(t('vocabEmpty'))
          } else setError(fresh.message)
          if (reloadWords) void reloadWords()
          if (onAnswered) void onAnswered()
        }, 4000)
        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [job, limit, reloadWords])

      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.repeat || document.querySelector('[role="dialog"]')) return
          const tag = (event.target?.tagName || '').toLowerCase()
          if (['input', 'textarea', 'select', 'button', 'a'].includes(tag) || event.target?.isContentEditable || event.target?.closest?.('[role="dialog"]')) return
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

      const generateButton = (label) =>
        h(
          Btn,
          { primary: true, small: true, disabled: generating || busy, onClick: () => generateMore() },
          generating ? t('generatingWords') : label
        )

      let body = null
      if (!ids) {
        body = error ? h('div', null, h(Notice, { tone: 'error' }, error), h(Btn, { onClick: () => setBatchRetry((value) => value + 1) }, t('retry'))) : h('div', { className: 'ec-empty' }, t('loading'))
      } else if (finished) {
        body = h(
          'div',
          { className: 'ec-done-card' },
          h('div', { className: 'ec-done-mark' }, '✓'),
          h('h2', null, t('reviewDone')),
          h('div', { className: 'ec-muted', style: { marginTop: 6 } }, `本轮 ${ids.length} 项，已作答 ${answered} 项${answered < ids.length ? `，跳过 ${ids.length - answered} 项` : ''}。`),
          h('div', { className: 'ec-muted', style: { marginTop: 6 } }, t('reviewDoneHint', { n: correct })),
          h(
            'div',
            { className: 'ec-acts' },
            generateButton(t('continueLearning')),
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
            h('span', { className: 'ec-sub' }, `本轮第 ${index + 1} / ${ids.length} 项`)
          ),
          h('div', { className: 'ec-term-line' },
            h('div', { className: 'ec-deck-term' }, word.term), h(PronounceButton, { text: word.term })),
          h('div', { className: 'ec-deck-prompt' }, t('pickMeaning')),
          h(ChoiceList, {
            choices: word.choices ?? [],
            answerIndex: word.answerIndex,
            picked,
            onPick: (choice) => void answer(choice),
            disabled: busy || conflict
          }),
          error ? h(Notice, { tone: 'error' }, error) : null,
          conflict ? h(Btn, { onClick: next }, t('nextWord')) : null,
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
            ids === null ? '' : finished ? '本轮完成' : ids.length ? `本轮 ${ids.length} 项` : '本轮尚未开始'
          )
        ),
        batchNotice(batch) ? h(Notice, null, batchNotice(batch)) : null,
        body,
        (!word || finished) && ids !== null ? h('div', { className: 'ec-row', style: { marginTop: 10 } },
          h(Btn, { ghost: true, small: true, onClick: onChooseList ?? onGoWords }, '选择词库'),
          h(Btn, { small: true, disabled: busy || generating, onClick: () => generateMore(true) }, '按画像补词')) : null
      )
    }

    const libraryBrowse = new Map()
    let libraryTab = 'personal'
    let libraryList = 'cet4'
    function PreferenceDialog({ title, busy, onClose, onSave, children, confirmLabel }) {
      const dialog = useRef(null)
      useEffect(() => { dialog.current?.querySelector('select,input,button')?.focus() }, [])
      return h('div', { className: 'ec-modal-back', onClick: () => { if (!busy) onClose() } },
        h('form', { className: 'ec-modal', role: 'dialog', 'aria-modal': true, 'aria-label': title, ref: dialog,
          onClick: event => event.stopPropagation(), onSubmit: event => { event.preventDefault(); if (!busy) void onSave() },
          onKeyDown: event => {
            if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose() }
            if (event.key === 'Tab') {
              const controls = [...event.currentTarget.querySelectorAll('button,input,select')].filter(node => !node.disabled)
              const first = controls[0], last = controls.at(-1)
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
            }
          } },
          h('h2', null, title), h('p', { className: 'ec-muted' }, '下一批生效，本轮题目和旧课程不变。'),
          children,
          h('div', { className: 'ec-row', style: { marginTop: 18 } },
            h(Btn, { primary: true, type: 'submit', disabled: busy }, busy ? '保存中…' : confirmLabel),
            h(Btn, { ghost: true, onClick: onClose, disabled: busy }, '取消'))))
    }

    function WordsTab({ data, words, reload, openThemed, openPersonal, onChooseList }) {
      const [catalog, setCatalog] = useState(null)
      const [catalogError, setCatalogError] = useState(null)
      const [catalogRetry, setCatalogRetry] = useState(0)
      const [sourceOpen, setSourceOpen] = useState(false)
      const sourceWasOpen = useRef(false)
      const [sourceDraft, setSourceDraft] = useState('')
      const [saving, setSaving] = useState(false)
      const saveLock = useRef(false)
      const [notice, setNotice] = useState(null)
      const [saveError, setSaveError] = useState(null)
      const sourceTrigger = useRef(null)
      const [batchSize, setBatchSize] = useState(data.settings?.study?.wordsPerDay ?? 10)
      const preferenceRead = useRef(0)
      const [batchOpen, setBatchOpen] = useState(false)
      const batchWasOpen = useRef(false)
      const [batchDraft, setBatchDraft] = useState('')
      const [batchSaving, setBatchSaving] = useState(false)
      const batchLock = useRef(false)
      const [batchError, setBatchError] = useState(null)
      const batchTrigger = useRef(null)
      const savedBatchSize = batchSize
      useEffect(() => {
        if (sourceWasOpen.current && !sourceOpen) sourceTrigger.current?.focus()
        sourceWasOpen.current = sourceOpen
      }, [sourceOpen])
      useEffect(() => {
        if (batchWasOpen.current && !batchOpen) batchTrigger.current?.focus()
        batchWasOpen.current = batchOpen
      }, [batchOpen])
      const closeBatch = () => { if (!batchLock.current) setBatchOpen(false) }
      const saveBatch = async () => {
        if (batchLock.current) return
        const size = Number(batchDraft)
        if (!String(batchDraft).trim() || !Number.isInteger(size) || size < 3 || size > 30) {
          setBatchError('每批学习词数必须是 3 到 30 的整数。')
          return
        }
        batchLock.current = true
        preferenceRead.current++
        setBatchSaving(true); setBatchError(null)
        // Send only this field; the command preserves source, audio and unknown preferences.
        const response = await call('settings.save', { study: { wordsPerDay: size } })
        batchLock.current = false
        setBatchSaving(false)
        if (!response.ok) { setBatchError(response.message); return }
        setBatchSize(response.data.study.wordsPerDay)
        setNotice('每批数量已保存，下一批生效；本轮题目不变。')
        closeBatch()
        if (reload) void reload()
      }
      useEffect(() => {
        let alive = true
        const refreshPreferences = async () => {
          const version = ++preferenceRead.current
          const [settings, lists] = await Promise.all([call('settings.get'), call('wordlists.list')])
          if (!alive || version !== preferenceRead.current) return
          if (settings.ok) setBatchSize(settings.data.study?.wordsPerDay ?? 10)
          if (lists.ok) { setCatalog(lists.data); setCatalogError(null) }
          else setCatalogError(lists.message)
        }
        settingsListeners.add(refreshPreferences)
        void refreshPreferences()
        return () => { alive = false; preferenceRead.current++; settingsListeners.delete(refreshPreferences) }
      }, [catalogRetry, data.settings])
      const closeSource = () => { if (!saveLock.current) setSourceOpen(false) }
      const selectSource = async id => {
        if (saveLock.current) return false
        saveLock.current = true
        preferenceRead.current++
        setSaving(true); setSaveError(null); setNotice(null)
        const response = await call('wordlists.select', { id })
        saveLock.current = false
        setSaving(false)
        if (!response.ok) { setSaveError(response.message); return false }
        setCatalog(previous => ({ ...previous, activeWordListId: response.data.activeWordListId }))
        setNotice('偏好已保存，下一批生效；本轮题目和旧课程不变。')
        if (sourceOpen) closeSource()
        return true
      }
      const activeTitle = catalog?.lists?.find(list => list.id === catalog.activeWordListId)?.title ?? '不指定'
      return h('div', { className: 'ec-words-page' },
        h('div', { className: 'ec-study-focus' },
          h(WordDeck, { words, now: data.now, limit: savedBatchSize,
            reloadWords: words.reload, onChooseList,
            onAnswered: async () => { await reload(); await words.reload() } }),
          h('aside', { className: 'ec-study-arrangement', 'aria-label': '学习安排' },
            h('h2', null, '学习安排'),
            h('p', null, `全部待复习 ${words.data?.dueCount ?? data.review?.dueCount ?? 0} 项`),
            h('p', { className: 'ec-sub' }, `每批学习 ${savedBatchSize} 项；不是每日上限。`),
            h('button', { type: 'button', className: 'ec-btn ec-btn-ghost ec-btn-sm', ref: batchTrigger, disabled: batchSaving,
              onClick: () => { setBatchDraft(String(savedBatchSize)); setBatchError(null); setBatchOpen(true) } }, '调整每批数量'),
            h('p', null, `新词优先来自：${catalog ? activeTitle : '加载中…'}`),
            h('button', { type: 'button', className: 'ec-btn ec-btn-ghost ec-btn-sm', disabled: !catalog || saving, ref: sourceTrigger,
              onClick: () => { setSourceDraft(catalog.activeWordListId ?? ''); setSaveError(null); setSourceOpen(true) } }, '更换新词来源'),
            catalogError ? h(Notice, { tone: 'error' }, catalogError, h(Btn, { onClick: () => setCatalogRetry(n => n + 1) }, '重试词库来源')) : null,
            notice ? h('p', { className: 'ec-sub', role: 'status' }, notice) : null,
            saveError && !sourceOpen ? h(Notice, { tone: 'error' }, saveError) : null)),
        h(Library, { words, now: data.now, openThemed, openPersonal, catalog, onSelect: selectSource, saving }),
        sourceOpen ? h(PreferenceDialog, { title: '更换新词来源', busy: saving, onClose: closeSource,
          onSave: () => selectSource(sourceDraft || null), confirmLabel: '保存词库偏好' },
          h('label', { className: 'ec-label' }, '当前词库偏好',
            h('select', { className: 'ec-input', 'aria-label': '当前词库偏好', value: sourceDraft, disabled: saving, onChange: event => setSourceDraft(event.target.value) },
              h('option', { value: '' }, '不指定'), (catalog?.lists ?? []).map(list => h('option', { key: list.id, value: list.id }, list.title)))),
          h('p', { className: 'ec-sub' }, '选择不会加入整库；不指定时沿用画像和课程方向，不会自动生成新词。'),
          saveError ? h('div', { role: 'alert' }, h(Notice, { tone: 'error' }, saveError)) : null) : null,
        batchOpen ? h(PreferenceDialog, { title: '调整每批数量', busy: batchSaving, onClose: closeBatch,
          onSave: saveBatch, confirmLabel: '保存每批数量' },
          h('label', { className: 'ec-label' }, '每批学习词数',
            h('input', { className: 'ec-input', type: 'number', min: 3, max: 30, step: 1, 'aria-label': '每批学习词数',
              value: batchDraft, disabled: batchSaving, onChange: event => setBatchDraft(event.target.value) })),
          h('p', { className: 'ec-sub' }, '3 到 30 项，默认 10 项；不是每日上限，也不影响词表每页数量。'),
          batchError ? h('div', { role: 'alert' }, h(Notice, { tone: 'error' }, batchError)) : null) : null)
    }

    function Library({ words, now, openThemed = 0, openPersonal = 0, catalog, onSelect, saving }) {
      const [expanded, setExpanded] = useState(false)
      const personalGate = useRef(null)
      const themedGate = useRef(null)
      const [tab, setTab] = useState(libraryTab)
      const [listId, setListId] = useState(libraryList)
      const key = tab === 'personal' ? 'personal' : listId
      const defaults = { search: '', filter: 'all', page: 1, pageSize: 50 }
      const [query, setQuery] = useState(() => libraryBrowse.get(key) ?? defaults)
      const [result, setResult] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [retry, setRetry] = useState(0)
      const [open, setOpen] = useState(null)
      const trigger = useRef(null)
      const closeButton = useRef(null)
      const browseSelect = useRef(null)
      const sourceAction = useRef(null)
      const selectionPending = useRef(false)
      const restoreBrowseFocus = useRef(false)
      useEffect(() => {
        if (restoreBrowseFocus.current && catalog?.activeWordListId === listId) {
          browseSelect.current?.focus()
          restoreBrowseFocus.current = false
        }
      }, [catalog?.activeWordListId, listId])
      const selectBrowsed = async () => {
        if (selectionPending.current) return
        selectionPending.current = true
        restoreBrowseFocus.current = document.activeElement === sourceAction.current
        const saved = await onSelect(listId)
        selectionPending.current = false
        if (!saved) restoreBrowseFocus.current = false
      }
      useEffect(() => {
        if (!expanded) return
        let alive = true
        setLoading(true)
        setError(null)
        const command = tab === 'personal' ? 'vocabulary.query' : 'wordlists.query'
        call(command, { ...query, ...(tab === 'themed' ? { id: listId } : {}) }).then(response => {
          if (!alive) return
          setLoading(false)
          if (!response.ok) { setError(response.message); return }
          setResult(response.data)
          libraryBrowse.set(key, { ...query, page: response.data.page })
        })
        return () => { alive = false }
      }, [key, query, retry, words?.data, expanded])
      const change = patch => {
        const next = { ...query, ...patch }
        libraryBrowse.set(key, next)
        setQuery(next)
      }
      const navigate = (nextTab, nextList = listId) => {
        setExpanded(true)
        libraryTab = nextTab; libraryList = nextList
        setTab(nextTab); setListId(nextList)
        setQuery(libraryBrowse.get(nextTab === 'personal' ? 'personal' : nextList) ?? defaults)
        setOpen(null); setResult(null)
      }
      useEffect(() => {
        if (openThemed) navigate('themed')
      }, [openThemed])
      useEffect(() => {
        if (openPersonal) navigate('personal')
      }, [openPersonal])
      const close = () => { setOpen(null); trigger.current?.focus() }
      useEffect(() => { if (open) closeButton.current?.focus() }, [open])
      const collapse = () => {
        setExpanded(false)
        setOpen(null)
        ;(tab === 'personal' ? personalGate : themedGate).current?.focus()
      }
      const toggle = nextTab => {
        if (expanded && tab === nextTab) collapse()
        else navigate(nextTab)
      }
      return h('div', { className: 'ec-library' },
        h('div', { className: 'ec-browse-gates', role: 'group', 'aria-label': '词汇来源' },
          h('button', { type: 'button', className: 'ec-browse-gate', ref: personalGate, 'aria-controls': 'ec-vocabulary-browser', 'aria-expanded': expanded && tab === 'personal', onClick: () => toggle('personal') },
            h('strong', null, '我的词汇'), h('span', { 'aria-hidden': true }, '查找已加入的单词和表达')),
          h('button', { type: 'button', className: 'ec-browse-gate', ref: themedGate, 'aria-controls': 'ec-vocabulary-browser', 'aria-expanded': expanded && tab === 'themed', onClick: () => toggle('themed') },
            h('strong', null, '主题词库'), h('span', { 'aria-hidden': true }, '浏览四级、六级和雅思词汇'))),
        expanded ? h('section', { className: 'ec-card', id: 'ec-vocabulary-browser', 'aria-label': tab === 'personal' ? '我的词汇浏览' : '主题词库浏览' },
        h('div', { className: 'ec-card-head' }, h('h2', null, tab === 'personal' ? '我的词汇' : '主题词库'), h('span', { className: 'ec-sub' }, result ? `共 ${result.total} 条` : ''),
          h(Btn, { ghost: true, small: true, onClick: collapse }, '收起词汇浏览')),
        tab === 'themed' ? h('div', null,
          h('label', null, '浏览词库 ', h('select', { className: 'ec-input', ref: browseSelect, 'aria-label': '浏览词库', value: listId, onChange: e => navigate('themed', e.target.value) },
            (catalog?.lists ?? []).map(list => h('option', { key: list.id, value: list.id }, list.title)))),
          h('p', { className: 'ec-sub' }, result?.list ? `开源学习参考，非官方考试全集。目录 ${result.list.total} · 可练 ${result.list.playableCount} · 暂不可练 ${result.list.unavailableCount}` : '正在加载目录…'),
          h('div', { className: 'ec-row' },
            catalog?.activeWordListId === listId ? h('span', { className: 'ec-chip ec-chip-brand', role: 'status' }, '这是当前词库') :
              h('button', { type: 'button', className: 'ec-btn ec-btn-ghost ec-btn-sm', ref: sourceAction, disabled: saving || !catalog, onClick: () => void selectBrowsed() }, saving ? '保存中…' : '设为当前词库')),
          h('p', { className: 'ec-sub' }, `已保存当前词库：${catalog?.lists?.find(list => list.id === catalog.activeWordListId)?.title ?? '不指定'}；浏览不会加入个人学习。`)
        ) : null,
        h('div', { className: 'ec-row', style: { flexWrap: 'wrap', marginTop: 12 } },
          h('input', { className: 'ec-input', 'aria-label': '搜索词汇或中文释义', placeholder: '搜索英文或中文释义', value: query.search, onChange: e => change({ search: e.target.value, page: 1 }), style: { minWidth: 0, flex: '1 1 150px' } }),
          h('select', { className: 'ec-input', 'aria-label': '词汇状态筛选', value: query.filter, onChange: e => change({ filter: e.target.value, page: 1 }) },
            (tab === 'personal' ? [['all', '全部'], ['learning', '在学'], ['mastered', '已掌握']] : [['all', '全部'], ['joined', '已加入'], ['unjoined', '未加入']]).map(([value, label]) => h('option', { key: value, value }, label))),
          h('select', { className: 'ec-input', 'aria-label': '每页条数', value: query.pageSize, onChange: e => change({ pageSize: Number(e.target.value), page: 1 }) }, h('option', { value: 50 }, '每页 50 条'), h('option', { value: 20 }, '每页 20 条'))),
        error ? h(Notice, { tone: 'error' }, error, h(Btn, { small: true, onClick: () => setRetry(n => n + 1) }, '重试')) : null,
        loading ? h('div', { role: 'status' }, '加载中…') : !error ? h('div', { className: 'ec-lib-list' },
          result?.items.length ? result.items.map(item => h('div', { key: item.id, className: 'ec-row', style: { alignItems: 'center' } },
            h('button', { type: 'button', className: 'ec-lib-row', style: { flex: 1, minWidth: 0 }, onClick: e => { trigger.current = e.currentTarget; setOpen(item) } },
              h('span', { className: 'ec-lib-term' }, item.term),
              h('span', { className: 'ec-sub' }, item.meaning),
              tab === 'themed' ? h('span', { className: 'ec-chip' }, `${item.joined ? '已加入' : '未加入'} · ${item.practice.status === 'ready' ? '可练' : '暂不可练'}`) : h('span', { className: 'ec-when' }, dueLabel(item, now))),
            typeof PronounceButton === 'function' ? h(PronounceButton, { text: item.term }) : null
          )) : h('div', { className: 'ec-empty' }, '没有匹配的词汇。',
            query.search || query.filter !== 'all' ? h('div', null, h(Btn, { small: true, ghost: true, onClick: () => change({ search: '', filter: 'all', page: 1 }) }, '清除搜索和筛选')) : null)) : null,
        h('div', { className: 'ec-row', style: { flexWrap: 'wrap', marginTop: 12 } },
          h(Btn, { small: true, disabled: loading || !result || result.page <= 1, onClick: () => change({ page: result.page - 1 }) }, '上一页'),
          h('span', { role: 'status' }, `第 ${result?.page ?? 1} / ${result?.pages ?? 1} 页`),
          h(Btn, { small: true, disabled: loading || !result || result.page >= result.pages, onClick: () => change({ page: result.page + 1 }) }, '下一页')),
        open ? h('div', { className: 'ec-modal-back', onClick: close },
          h('div', { className: 'ec-modal', role: 'dialog', 'aria-modal': true, 'aria-label': `${open.term} 词汇详情`, onClick: e => e.stopPropagation(), onKeyDown: e => {
            if (e.key === 'Escape') { e.stopPropagation(); close() }
            if (e.key === 'Tab') { const nodes = [...e.currentTarget.querySelectorAll('button,input,select,a[href]')].filter(node => !node.disabled); const first = nodes[0], last = nodes.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() } }
          } },
            h('button', { type: 'button', className: 'ec-btn', ref: closeButton, onClick: close }, '关闭词汇详情'),
            h('div', { className: 'ec-modal-term' }, open.term),
            typeof PronounceButton === 'function' ? h(PronounceButton, { text: open.term }) : null,
            h('div', { className: 'ec-modal-meaning' }, open.translation || open.meaning),
            open.practice ? h('div', null, h('p', null, `所属词库：${open.listIds.join(' / ')}；原始标签：${open.sourceTags.join(' / ')}`), h('p', null, open.practice.status === 'ready' ? '可练：已准备基础四选练习' : `暂不可练：${open.practice.reason}`), h('p', null, open.joined ? '已加入我的词汇' : '尚未加入个人学习')) : h('p', null, `${dueLabel(open, now)} · 作答 ${open.answerCount ?? 0} 次`),
            open.explanation ? h('p', { className: 'ec-note' }, open.explanation) : null)) : null) : null)
    }

    function TodayTab({ data, words, reload, reloadWords, onTab, onChooseList, onOpenVocabulary }) {
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
              onChooseList,
              onGoWords: onOpenVocabulary
            }),
            h(SpeechOptions),
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
      const records = (points ?? []).map((point, index) => ({ ...point, order: index }))
        .sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.order - b.order)
      if (!records.length) return h('p', { className: 'ec-muted' }, '还没有测评记录，完成一次测评后可在这里回顾。')
      const width = 600, height = 200, left = 68, right = 24, top = 18, bottom = 36
      const valueOf = point => Number.isFinite(point.estimate) ? Math.min(6, Math.max(1, point.estimate)) : Math.max(1, BANDS.indexOf(point.band) + 1)
      const xs = records.map((_, index) => records.length === 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (records.length - 1))
      const yOf = value => height - bottom - ((value - 1) / 5) * (height - top - bottom)
      const d = xs.map((x, index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${yOf(valueOf(records[index])).toFixed(1)}`).join(' ')
      const dateIndexes = [...new Set([0, Math.floor((records.length - 1) / 2), records.length - 1])]
      const dateLabel = at => {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(at))
        return match ? `${Number(match[2])}月${Number(match[3])}日` : '日期未提供'
      }
      return h('div', { className: 'ec-curve-wrap' },
        h('div', { className: 'ec-curve-scroll' }, h('svg', { className: 'ec-curve-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `水平变化，共 ${records.length} 次测评；完整日期和升降见下方测评记录` },
          h('title', null, '水平变化：档位随历次测评变化，不是考试分数'),
          BANDS.map((band, index) => h('g', { key: band },
            h('line', { x1: left, x2: width - right, y1: yOf(index + 1), y2: yOf(index + 1), className: 'ec-curve-grid' }),
            h('text', { x: left - 12, y: yOf(index + 1) + 4, textAnchor: 'end', className: 'ec-curve-label' }, band))),
          records.length > 1 ? h('path', { d, fill: 'none', className: 'ec-curve-line' }) : null,
          records.map((point, index) => h('circle', { key: `${point.at}-${point.order}`, cx: xs[index], cy: yOf(valueOf(point)), r: 3.5, className: 'ec-curve-point' }, h('title', null, `${point.at} ${point.band}`))),
          dateIndexes.map(index => h('text', { key: index, x: xs[index], y: height - 10, textAnchor: records.length === 1 ? 'middle' : index === 0 ? 'start' : index === records.length - 1 ? 'end' : 'middle', className: 'ec-curve-label' }, dateLabel(records[index].at))))),
        records.length === 1 ? h('p', { className: 'ec-muted' }, '目前有 1 次测评，再测一次后可比较变化。') : null,
        h('h3', { className: 'ec-profile-detail-heading' }, '测评记录'),
        h('ol', { className: 'ec-curve-records', 'aria-label': '测评记录' }, records.map((point, index) => {
          const difference = index ? valueOf(point) - valueOf(records[index - 1]) : null
          const change = difference === null ? '首次记录' : difference > 0 ? '较上次上升' : difference < 0 ? '较上次下降' : '与上次持平'
          return h('li', { key: `${point.at}-${point.order}` },
            h('time', { dateTime: point.at }, String(point.at ?? '').replace('T', ' ').replace(/(?:\.\d+)?Z$/, ' UTC') || '日期未提供'),
            h('strong', null, point.band || '档位未提供'), h('span', null, change))
        })))
    }

    /**
     * A 方案个人页：先看已保存的目标和当前估计，再按需回顾学习记录。
     * 编辑草稿与只读查看分离；编辑时隐藏但不卸载进度，保留展开状态和读取结果。
     * 画像仍由既有命令写入，局部导航与卸载保护沿用同一份草稿状态。
     */
    function ProfileTab({ data, reload, leaveGuard, onAssess }) {
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState(data.profile ?? null)
      const [dirty, setDirty] = useState(false)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [interestText, setInterestText] = useState('')
      const [fullGoal, setFullGoal] = useState(false)
      const savedProfile = useRef(data.profile)
      const editButton = useRef(null)
      const firstField = useRef(null)
      const restoreFocus = useRef(false)
      const saving = useRef(false)
      const [pendingLeave, setPendingLeave] = useState(null)
      const continueEditingButton = useRef(null)
      useEffect(() => { if (pendingLeave) continueEditingButton.current?.focus() }, [pendingLeave])

      useEffect(() => {
        if (!leaveGuard) return
        leaveGuard.current = (proceed) => {
          if (saving.current) {
            setStatus({ tone: 'info', text: '正在保存，请等待保存结果后再离开。' })
            return false
          }
          if (!editing || !dirty) { proceed(); return true }
          setPendingLeave(() => proceed)
          return false
        }
        return () => { leaveGuard.current = null }
      }, [leaveGuard, editing, dirty])

      useEffect(() => {
        if (!editing || !dirty) return
        const beforeUnload = (event) => { event.preventDefault(); event.returnValue = '' }
        window.addEventListener('beforeunload', beforeUnload)
        return () => window.removeEventListener('beforeunload', beforeUnload)
      }, [editing, dirty])

      useEffect(() => {
        if (editing) firstField.current?.focus()
        else if (restoreFocus.current) {
          editButton.current?.focus()
          restoreFocus.current = false
        }
      }, [editing])

      useEffect(() => {
        // 不让迟到的轮询快照覆盖刚保存的结果；编辑草稿独立保留。
        const incoming = data.profile
        if (savedProfile.current?.updatedAt && (!incoming?.updatedAt || incoming.updatedAt < savedProfile.current.updatedAt)) return
        savedProfile.current = incoming
        if (dirty || busy) return
        setDraft(incoming ?? null)
      }, [data.profile])

      if (!draft) {
        return h('section', { className: 'ec-card' }, h('div', { className: 'ec-empty' }, t('loading')))
      }

      const cancel = () => {
        setDraft(savedProfile.current)
        setInterestText('')
        setDirty(false)
        setStatus(null)
        setPendingLeave(null)
        restoreFocus.current = true
        setEditing(false)
      }
      const interests = Array.isArray(draft.interests) ? draft.interests : []
      const update = (patch) => {
        setDraft({ ...draft, ...patch })
        setDirty(true)
        setStatus(null)
      }

      const collectInterests = () => {
        const next = [...new Set([...interests, ...interestText.split(/[,，]/).map((item) => item.trim()).filter(Boolean)])]
        if (next.length > 12) {
          setStatus({ tone: 'error', text: t('interestLimit') })
          return null
        }
        return next
      }

      const addInterest = () => {
        const next = collectInterests()
        if (!next) return
        update({ interests: next })
        setInterestText('')
      }

      const save = async () => {
        if (saving.current) return
        const next = collectInterests()
        if (!next) return
        saving.current = true
        setBusy(true)
        const result = await call('profile.save', {
          ...draft,
          minutesPerDay: Number(draft.minutesPerDay),
          goalNote: String(draft.goalNote ?? ''),
          interests: next
        })
        if (!result.ok) {
          setBusy(false)
          setStatus({ tone: 'error', text: result.message })
          saving.current = false
          return
        }
        saving.current = false
        // Use the saved value immediately, rather than briefly restoring the old polling snapshot.
        savedProfile.current = result.data.profile
        setDraft(result.data.profile)
        setInterestText('')
        setStatus({ tone: 'success', text: t('saved') })
        setDirty(false)
        setBusy(false)
        restoreFocus.current = true
        setEditing(false)
        if (pendingLeave) {
          setPendingLeave(null)
          pendingLeave()
        }
        if (reload) void reload()
      }

      return h(
        'div',
        { className: `ec-page ec-profile-page${editing ? ' ec-profile-page-editing' : ''}` },
        h(
          'section',
          { className: 'ec-card ec-profile-goal' },
          h(
            'div',
            { className: 'ec-profile-section-head' },
            h('h2', null, editing ? '编辑个人目标' : t('profileTitle')),
            h('span', { className: 'ec-sub' }, editing ? '保存后用于安排后续学习，已有进度不变。' : t('profileHint'))
          ),
          !editing ? h(React.Fragment, null,
            h('div', { style: { marginTop: 12, overflowWrap: 'anywhere' } },
              h('div', null, `${t(`goal${String(draft.goal ?? 'other')[0].toUpperCase()}${String(draft.goal ?? 'other').slice(1)}`)} · 每天 ${draft.minutesPerDay ?? 30} 分钟 · 目标 ${draft.targetBand || '暂未设定'}`),
              h('div', { className: 'ec-profile-goal-note' }, draft.goalNote ? (fullGoal || draft.goalNote.length <= 80 ? draft.goalNote : `${draft.goalNote.slice(0, 80)}…`) : '还没有填写具体目标'),
              h('div', { className: 'ec-muted' }, `兴趣：${(fullGoal ? interests : interests.slice(0, 3)).map(text => fullGoal || text.length <= 16 ? text : `${text.slice(0, 16)}…`).join('、') || '暂未填写'}${!fullGoal && interests.length > 3 ? ` 等 ${interests.length} 项` : ''}`),
              (draft.goalNote?.length > 80 || interests.length > 3 || interests.some(text => text.length > 16)) ? h('button', { type: 'button', className: 'ec-profile-link', 'aria-expanded': fullGoal, onClick: () => setFullGoal(value => !value) }, fullGoal ? '收起完整目标' : '查看完整目标') : null),
            h('div', { className: 'ec-profile-comparison', role: 'group', 'aria-label': '当前与目标' },
              h('div', null, h('span', null, '当前水平估计'), h('b', null, data.level?.latest?.band || '尚未测评')),
              h('div', null, h('span', null, '目标档位'), h('b', null, draft.targetBand || '暂未设定')),
              onAssess ? h('button', { type: 'button', className: 'ec-profile-link', onClick: onAssess }, data.level?.latest ? '重新测评' : '开始测评') : null),
            h('button', { type: 'button', className: 'ec-btn', ref: editButton, onClick: () => { setDraft(savedProfile.current); setStatus(null); setEditing(true) }, style: { marginTop: 12 } }, '编辑个人目标')) : h(
            'fieldset',
            { className: 'ec-form', disabled: busy, style: { border: 0, padding: 0, minWidth: 0 } },
            h(
              'div',
              { className: 'ec-field' },
              h('label', { className: 'ec-label' }, t('goal')),
              h(
                'select',
                {
                  className: 'ec-select',
                  ref: firstField,
                  'aria-label': t('goal'),
                  value: draft.goal ?? 'work',
                  onChange: (event) => update({ goal: event.target.value })
                },
                GOALS.map((goal) =>
                  h(
                    'option',
                    { key: goal, value: goal },
                    t(`goal${goal[0].toUpperCase()}${goal.slice(1)}`)
                  )
                )
              )
            ),
            h(
              'div',
              { className: 'ec-field' },
              h('label', { className: 'ec-label' }, t('minutes')),
              h('input', {
                className: 'ec-input',
                type: 'number',
                min: 5,
                max: 180,
                'aria-label': t('minutes'),
                value: draft.minutesPerDay ?? 30,
                onChange: (event) => update({ minutesPerDay: event.target.value })
              })
            ),
            h(
              'div',
              { className: 'ec-field' },
              h('label', { className: 'ec-label' }, t('targetBand')),
              h(
                'select',
                {
                  className: 'ec-select',
                  'aria-label': t('targetBand'),
                  value: draft.targetBand ?? '',
                  onChange: (event) => update({ targetBand: event.target.value })
                },
                h('option', { value: '' }, '暂未设定'),
                BANDS.map((band) => h('option', { key: band, value: band }, band))
              )
            ),
            h(
              'div',
              { className: 'ec-field ec-wide' },
              h('label', { className: 'ec-label' }, t('goalNote')),
              h('textarea', {
                className: 'ec-input ec-profile-note-input',
                rows: 3,
                'aria-label': t('goalNote'),
                value: draft.goalNote ?? '',
                placeholder: t('goalNotePlaceholder'),
                onChange: (event) => update({ goalNote: event.target.value })
              })
            ),
            h(
              'div',
              { className: 'ec-field ec-wide' },
              h('label', { className: 'ec-label' }, t('interests')),
              h(
                'div',
                { className: 'ec-chip-row' },
                interests.map((item) =>
                  h(
                    'span',
                    { key: item, className: 'ec-chip ec-chip-edit' },
                    item,
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'ec-chip-x',
                        title: `${t('removeInterest')} ${item}`,
                        'aria-label': `${t('removeInterest')} ${item}`,
                        onClick: () => update({ interests: interests.filter((entry) => entry !== item) })
                      },
                      '×'
                    )
                  )
                ),
                h('input', {
                  className: 'ec-chip-input',
                  type: 'text',
                  value: interestText,
                  placeholder: t('interestAdd'),
                  'aria-label': t('interests'),
                  onChange: (event) => { setInterestText(event.target.value); setDirty(true); setStatus(null) },
                  onKeyDown: (event) => {
                    if (event.nativeEvent?.isComposing || event.isComposing) return
                    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                      event.preventDefault()
                      addInterest()
                    }
                  }
                }),
                h(Btn, { small: true, onClick: addInterest, disabled: !interestText.trim() }, '添加')
              ),
              h('div', { className: 'ec-muted', style: { marginTop: 6 } }, t('profileInterestsHint'))
            )
          ),
          editing ? h(
            'div',
            { className: 'ec-row', style: { marginTop: 16 } },
            h(Btn, { primary: true, onClick: save, disabled: busy || !dirty }, busy ? t('saving') : t('save')),
            h(Btn, { ghost: true, onClick: cancel, disabled: busy }, '取消')
          ) : null,
          status ? h('div', { role: status.tone === 'error' ? 'alert' : 'status', style: { marginTop: 10 } }, h(Notice, { tone: status.tone }, status.text)) : null,
          pendingLeave ? h('div', { role: 'alert', className: 'ec-feedback' },
            h('p', null, '个人目标有未保存的修改。继续编辑，或放弃修改后离开。'),
            h('div', { className: 'ec-row' },
              h('button', { type: 'button', className: 'ec-btn', ref: continueEditingButton, onClick: () => { setPendingLeave(null); firstField.current?.focus() } }, '继续编辑'),
              h(Btn, { ghost: true, onClick: () => { const proceed = pendingLeave; setPendingLeave(null); cancel(); proceed() } }, '放弃修改并离开'))) : null
        ),
        h('div', { hidden: editing, 'data-profile-progress': true, style: { marginTop: 16 } }, h(ProgressTab, { data }))
      )
    }

    function ProgressTab({ data }) {
      const [readState, setReadState] = useState({ data: null, error: null })
      const readRequest = useRef(0)
      const mounted = useRef(false)
      const reloadProgress = useCallback(async () => {
        const request = ++readRequest.current
        const result = await loadProgress()
        if (!mounted.current || request !== readRequest.current) return
        setReadState(previous => result.ok ? { data: result.data, error: null } : { ...previous, error: result.message })
      }, [])
      useEffect(() => {
        mounted.current = true
        void reloadProgress()
        const timer = setInterval(() => void reloadProgress(), 20000)
        return () => { mounted.current = false; readRequest.current++; clearInterval(timer) }
      }, [reloadProgress])
      const { data: progress, error } = readState
      const [showRecords, setShowRecords] = useState(false)
      const [showDiagnostics, setShowDiagnostics] = useState(false)
      const failure = error ? h('div', { className: 'ec-profile-read-error', role: 'alert' },
        h('p', null, `${error}${progress ? '。当前进度已保留。' : ''}`), h(Btn, { small: true, onClick: reloadProgress }, '重试读取进度')) : null

      if (!progress) return h('section', { className: 'ec-card' }, failure || h('div', { className: 'ec-empty', role: 'status' }, '正在读取学习进度…'))

      const latest = data.level?.latest
      const weaknesses = latest?.weaknesses ?? []
      const knownWeaknesses = weaknesses.filter(item => SKILL_LABEL[item.skill] && Number(item.missed) > 0)
      const mostMissed = Math.max(0, ...knownWeaknesses.map(item => Number(item.missed)))
      const focusSkills = knownWeaknesses.filter(item => Number(item.missed) === mostMissed).map(item => SKILL_LABEL[item.skill])
      const suggestion = !latest ? '尚未测评，完成测评后可了解值得多练的方向。' : focusSkills.length
        ? `最近测评中，${focusSkills.join('、')}${focusSkills.length > 1 ? '并列' : ''}丢分较多，可以优先练习。`
        : '最近测评没有明确可判断的薄弱方向，可以继续按目标练习。'
      return h('div', { className: 'ec-profile-progress' },
        failure,
        h('section', { className: 'ec-card ec-profile-overview' },
          h('div', { className: 'ec-profile-section-head' }, h('h2', null, t('progressTitle')),
            h('button', { type: 'button', className: 'ec-profile-link', 'aria-expanded': showRecords, onClick: () => setShowRecords(value => !value) }, showRecords ? '收起记录' : '查看记录')),
          h('dl', { className: 'ec-profile-metrics', 'aria-label': '学习概况' },
            h('div', null, h('dd', null, String(progress.completions.length)), h('dt', null, t('completedDays'))),
            h('div', null, h('dd', null, String(progress.streak.current)), h('dt', null, t('streakDays'))),
            h('div', null, h('dd', null, String(progress.mastered)), h('dt', null, t('masteredWords')))),
          h('p', { className: 'ec-profile-suggestion', 'aria-label': '下一步建议' }, suggestion)),
        showRecords ? h('section', { className: 'ec-card ec-profile-records', 'aria-label': '学习记录详情' },
          h('h2', null, t('curve')), h(Curve, { points: progress.curve }),
          h('p', { className: 'ec-muted' }, '水平估计只作学习参考，不与考试分数等价。'),
          h('dl', { className: 'ec-profile-detail-facts' },
            h('div', null, h('dt', null, t('learningWords')), h('dd', null, `${progress.learning} 项`)),
            h('div', null, h('dt', null, '最长连续'), h('dd', null, `${progress.streak.best} 天`))),
          h('h3', { className: 'ec-profile-detail-heading' }, '档位参照'),
          h('p', { className: 'ec-muted' }, latest ? latest.reference || '本次测评未提供档位参照。' : '尚未测评，完成测评后可查看档位参照。'),
          h('h3', { className: 'ec-profile-detail-heading' }, t('resultWeak')),
          weaknesses.length ? h('ul', { className: 'ec-profile-weaknesses' }, weaknesses.map((item, index) => h('li', { key: `${item.skill}-${index}` }, `${SKILL_LABEL[item.skill] ?? item.skill}：${t('missedCount', { n: item.missed ?? 0 })}`))) : h('p', { className: 'ec-muted' }, latest ? t('resultWeakNone') : '尚无测评记录，不能判断薄弱项。'),
          progress.drift?.note ? h('p', { className: 'ec-muted' }, `${t('driftNote')}：${progress.drift.note}`) : null,
          h('button', { type: 'button', className: 'ec-profile-link', 'aria-expanded': showDiagnostics, onClick: () => setShowDiagnostics(value => !value) }, t('diagnostics')),
          showDiagnostics ? h('div', { className: 'ec-profile-diagnostics' },
            (progress.curve ?? []).slice().reverse().map((point, index) => h('p', { key: index }, `${String(point.at).slice(0, 10)}　${point.band}　${t('accuracy')} ${Math.round((point.accuracy ?? 0) * 100)}%`)),
            h('p', null, `${t('expiredDrafts')}：${progress.expiredDrafts ?? 0}`)) : null) : null)
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
      const [openThemed, setOpenThemed] = useState(0)
      const [openPersonal, setOpenPersonal] = useState(0)
      const leaveGuard = useRef(null)
      const navigate = useCallback((proceed) => {
        if (leaveGuard.current) return leaveGuard.current(proceed)
        proceed()
        return true
      }, [])
      const changeTab = (next) => { if (next !== tab) navigate(() => setTab(next)) }
      const openVocabulary = () => navigate(() => { setTab('words'); setOpenThemed(0); setOpenPersonal(value => value + 1) })
      const chooseList = () => navigate(() => { setTab('words'); setMode('normal'); setOpenPersonal(0); setOpenThemed(value => value + 1) })
      const startAssessment = () => navigate(() => setMode('assessment'))
      const { data, error, loading, reload } = useRefresh(loadState, 20000)
      const words = useRefresh(loadWords, 0)

      useEffect(() => {
        const goHome = (nextTab = 'today') => navigate(() => { setTab(nextTab); setMode('normal'); if (nextTab === 'words') { setOpenPersonal(0); setOpenThemed(value => value + 1) } })
        homeListeners.add(goHome)
        return () => homeListeners.delete(goHome)
      }, [])

      // 悬浮层里答了词，这边的词库与到期数要跟着变；面板自己答完也走 reload。
      useEffect(() => {
        const listener = () => void words.reload()
        reviewListeners.add(listener)
        return () => reviewListeners.delete(listener)
      }, [words.reload])

      if (loading) {
        return h('div', { className: 'ec-root' }, h(Style), h('div', { className: 'ec-wrap' },
          h('div', { className: 'ec-empty' }, t('loading'))))
      }
      if (error && !data) {
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
        ['profile', t('profile')]
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
                  h(Btn, { primary: true, style: { marginLeft: 'auto' }, onClick: startAssessment },
                    t('startAssessment'))))
            : null,
          h(TodayTab, { data, words, reload, reloadWords: words.reload, onTab: changeTab, onChooseList: chooseList, onOpenVocabulary: openVocabulary }))
      } else if (tab === 'words') {
        content = h(WordsTab, { data, words, reload, openThemed, openPersonal, onChooseList: chooseList })
      } else if (tab === 'plan') {
        content = h(PlanTab, { data, reload })
      } else {
        content = h(ProfileTab, { data, reload, leaveGuard, onAssess: startAssessment })
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
                  { key: id, type: 'button', 'data-on': tab === id, onClick: () => changeTab(id) },
                  label
                )
              )
            ),
            h(
              'div',
              { className: 'ec-status' },
              h('span', null, `${t('dueShort')} `, h('b', null, String(due))),
              h('span', null, `${t('streakShort')} `, h('b', null, String(streak))),
              band && tab !== 'profile' ? h('span', null, `${t('bandShort')} `, h('b', null, band)) : null,
              h('button', { type: 'button', onClick: startAssessment }, t('assessmentShort'))
            )
          ),
          error ? h(Notice, { tone: 'error' }, `刷新失败：${error}。当前内容和未保存修改已保留。`) : null,
          content
        )
      )
    }

    // -------------------------------------------------------------- settings

    function SettingsPage() {
      const { data, error, reload } = useRefresh(loadState, 0)
      const [settings, setSettings] = useState(null)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [migrateTarget, setMigrateTarget] = useState('')
      const settingsRead = useRef(0)
      const savedSettings = useRef(null)
      const paceDraft = useRef(false)
      useEffect(() => {
        let alive = true
        const refreshSettings = async () => {
          const version = ++settingsRead.current
          const response = await call('settings.get')
          if (!alive || version !== settingsRead.current || !response.ok) return
          savedSettings.current = response.data
          setSettings(previous => paceDraft.current && previous ? { ...response.data, study: { ...response.data.study, wordsPerDay: previous.study.wordsPerDay } } : response.data)
        }
        settingsListeners.add(refreshSettings)
        void refreshSettings()
        return () => { alive = false; settingsRead.current++; settingsListeners.delete(refreshSettings) }
      }, [])
      useEffect(() => {
        if (!data || savedSettings.current) return
        savedSettings.current = data.settings
        setSettings(data.settings)
      }, [data])

      if (error) return h('div', { className: 'ec-settings' }, h(Style), h(Notice, { tone: 'error' }, error))
      if (!settings || !data) {
        return h('div', { className: 'ec-settings' }, h(Style), h('div', { className: 'ec-empty' }, t('loading')))
      }

      const saveSettings = async (patch) => {
        settingsRead.current++
        const result = await call('settings.save', patch)
        if (!result.ok) {
          setStatus({ tone: 'error', text: result.message })
          return
        }
        savedSettings.current = result.data
        paceDraft.current = false
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

        h('div', { className: 'ec-section-title' }, t('profileTitle')),
        h('div', { className: 'ec-muted', style: { marginBottom: 10 } }, t('profileSettingsNote')),

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
              paceDraft.current = true
              setSettings({ ...settings, study: { ...(settings.study ?? {}), wordsPerDay: raw } })
            },
            onBlur: (event) => {
              const words = Number(event.target.value)
              if (!Number.isInteger(words) || words < 3 || words > 30) {
                setStatus({ tone: 'error', text: t('wordsPerDayHint') })
                paceDraft.current = false
                setSettings({ ...settings, study: { ...settings.study, wordsPerDay: savedSettings.current?.study?.wordsPerDay ?? 10 } })
                return
              }
              paceDraft.current = false
              if (words !== (savedSettings.current?.study?.wordsPerDay ?? 10)) void saveSettings({ study: { wordsPerDay: words } })
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
     * The overlay is a small review surface of its own: one word, four choices,
     * then the explanation. Working in another session should not cost the
     * learner a trip to the panel for every card; the panel keeps the library
     * and the longer session, and both answer from the same queue.
     */
    function Pill({ getLayout }) {
      const { data, reload } = useRefresh(loadState, 30000)
      const [open, setOpen] = useState(false)
      const [queue, setQueue] = useState(null)
      const [session, setSession] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [job, setJob] = useState(null)
      const [lastDue, setLastDue] = useState(null)
      const batchLock = useRef(false)
      const batchGeneration = useRef(0)
      const [initialLoading, setInitialLoading] = useState(true)
      const [initialRetry, setInitialRetry] = useState(0)
      const [conflict, setConflict] = useState(false)

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

      // ------------------------------------------------------------ 复习会话
      const limit = data?.settings?.study?.wordsPerDay ?? 10
      const generating = job?.status === 'pending'
      const card = session && session.at < session.cards.length ? session.cards[session.at] : null
      const finished = Boolean(session) && session.cards.length > 0 && !card

      const startSession = (list) => {
        setSession({ cards: list?.items ?? [], at: 0, picked: null, feedback: null, correct: 0 })
        setConflict(false)
        setError(null)
      }

      const next = () => {
        setConflict(false)
        setError(null)
        setSession((prev) => (prev ? { ...prev, at: prev.at + 1, picked: null, feedback: null } : prev))
      }

      const answer = async (choice) => {
        if (!card || session.picked !== null || busy) return
        setBusy(true)
        setError(null)
        setSession((prev) => ({ ...prev, picked: choice }))
        const result = await call('review.answer', { itemId: card.id, choice })
        setBusy(false)
        if (!result.ok) {
          setConflict(result.code === 'not_due')
          setSession((prev) => ({ ...prev, picked: null }))
          setError(result.message)
          return
        }
        setLastDue(result.data.dueAt ?? null)
        setSession((prev) => ({
          ...prev,
          feedback: { correct: result.data.correct, explanation: result.data.explanation ?? '' },
          correct: prev.correct + (result.data.correct ? 1 : 0)
        }))
        // 药丸上的数字当场就变，不用等下一次轮询
        setQueue((prev) =>
          prev
            ? {
                ...prev,
                dueCount: Math.max(0, (prev.dueCount ?? 1) - 1),
                items: (prev.items ?? []).map((item) => (item.id === card.id ? { ...item, due: false } : item))
              }
            : prev
        )
        notifyReview()
        // 一轮答完，下一次到期要由服务端算：刚答的这批里，盒子不同的词
        // 排到的日期也不同，客户端猜不准
        if (session.at + 1 >= session.cards.length) {
          const fresh = await call('review.list')
          if (fresh.ok) setQueue(fresh.data)
        }
      }

      const continueRemaining = async (profile = false) => {
        if (batchLock.current || busy || generating || initialLoading || session === null) return
        const generation = ++batchGeneration.current
        batchLock.current = true
        setBusy(true)
        setError(null)
        const result = await call(profile === true ? 'generate.vocab' : 'study.supplement', profile === true ? { profile: true } : {})
        if (generation !== batchGeneration.current) return
        batchLock.current = false
        setBusy(false)
        if (!result.ok) { setError(result.message); return }
        if (result.data.mode === 'generated') setJob(result.data)
        else { setQueue(result.data); startSession(result.data) }
        notifyReview()
      }

      const generateMore = continueRemaining

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
          const fresh = await call('study.batch')
          if (!fresh.ok) { setError(fresh.message); return }
          setQueue(fresh.data)
          startSession(fresh.data)
          if (!fresh.data.items?.length) setError(t('vocabEmpty'))
        }, 4000)
        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [job])

      useEffect(() => {
        // 已有快照（包括已结束或空批次）只由显式继续操作替换。
        if (!open || session !== null) return undefined
        const generation = ++batchGeneration.current
        setInitialLoading(true)
        setError(null)
        void (async () => {
          const result = await call('study.batch')
          if (generation !== batchGeneration.current) return
          setInitialLoading(false)
          if (!result.ok) { setError(result.message); return }
          setQueue(result.data)
          setSession((prev) => prev ?? { cards: result.data.items ?? [], at: 0, picked: null, feedback: null, correct: 0 })
        })()
        return () => {
          if (generation === batchGeneration.current) batchGeneration.current++
        }
      }, [open, initialRetry])

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
      const lesson = data?.todayLesson
      const hasDraft = lesson && lesson.status === 'draft'
      const badge = dueCount > 0 ? dueCount : hasDraft ? '·' : ''
      const nextAt = queue?.nextDueAt ?? lastDue
      const nextText = !dueCount && nextAt ? t('nextDueShort', { date: formatDay(nextAt) }) : ''
      const quietText = finished
        ? t('reviewDoneHint', { n: session.correct })
        : hasDraft
          ? t('draftReady')
          : t('nothingDueHint')

      const openPanel = (nextTab = 'today') => {
        // Resolved at click time: on a cold boot the layout service may not
        // have existed when this component was registered.
        try {
          const layout = typeof getLayout === 'function' ? getLayout() : null
          if (layout && layout.selectPanel) {
            for (const goHome of homeListeners) goHome(nextTab === 'words' ? 'words' : 'today')
            layout.selectPanel('english-coach')
          }
        } catch {
          /* the panel entry may be gone */
        }
        setOpen(false)
      }

      const openDown = Boolean(pos && pos.y < 420)
      const pillStyle = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined

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
                  h(
                    'span',
                    null,
                    card
                      ? t('pillProgress', { i: session.at + 1, n: session.cards.length })
                      : dueCount
                        ? t('dueToday', { n: dueCount })
                        : t('nothingDueShort')
                  )
                ),
                initialLoading ? h('div', { role: 'status', className: 'ec-pop-hint' }, t('loading')) : session === null ? h(Btn, { onClick: () => setInitialRetry((value) => value + 1) }, t('retry')) : card
                  ? h(
                      'div',
                      null,
                      h('div', { className: 'ec-term-line' },
                        h('div', { className: 'ec-pop-term' }, card.term), h(PronounceButton, { text: card.term })),
                      h('div', { className: 'ec-pop-prompt' }, t('pickMeaning')),
                      h(ChoiceList, {
                        choices: card.choices ?? [],
                        answerIndex: card.answerIndex,
                        picked: session.picked,
                        onPick: (choice) => void answer(choice),
                        disabled: busy || conflict
                      }),
                      conflict ? h(Btn, { onClick: next }, t('nextWord')) : null,
                      session.feedback
                        ? h(
                            'div',
                            {
                              className: 'ec-fb',
                              'data-tone': session.feedback.correct ? 'ok' : 'err'
                            },
                            h(
                              'div',
                              { className: 'ec-verdict' },
                              session.feedback.correct ? t('correct') : t('wrong')
                            ),
                            h('div', { className: 'ec-meaning' }, card.meaning),
                            session.feedback.explanation
                              ? h('div', { className: 'ec-note' }, session.feedback.explanation)
                              : null,
                            h(
                              'div',
                              { className: 'ec-acts' },
                              h(
                                Btn,
                                { primary: true, small: true, onClick: next },
                                session.at + 1 >= session.cards.length
                                  ? t('finishReview')
                                  : t('nextWord')
                              )
                            )
                          )
                        : null
                    )
                  : h(
                      'div',
                      null,
                      h('div', { className: 'ec-pop-hint' }, quietText),
                      dueCount > 0
                        ? h(
                            Btn,
                            { primary: true, small: true, style: { marginTop: 12 }, onClick: continueRemaining },
                            t('continueReview', { n: dueCount })
                          )
                        : h(
                            Btn,
                            {
                              primary: true,
                              small: true,
                              style: { marginTop: 12 },
                              disabled: generating,
                              onClick: generateMore
                            },
                            generating ? t('generatingWords') : t('continueLearning')
                          ),
                      generating ? h('div', { className: 'ec-pop-hint' }, t('generatingWordsHint')) : null,
                      nextText ? h('div', { className: 'ec-pop-hint' }, nextText) : null
                    ),
                batchNotice(queue) ? h(Notice, null, batchNotice(queue)) : null,
                !card && !initialLoading && session !== null ? h('div', { className: 'ec-row', style: { marginTop: 10 } },
                  h(Btn, { small: true, onClick: () => openPanel('words') }, '选择词库'),
                  h(Btn, { small: true, disabled: busy || generating, onClick: () => continueRemaining(true) }, '按画像补词')) : null,
                error ? h(Notice, { tone: 'error' }, error) : null,
                h(
                  'div',
                  { className: 'ec-pop-acts' },
                  h(Btn, { ghost: true, small: true, onClick: openPanel }, t('studyInPanel')),
                  h(Btn, { ghost: true, small: true, onClick: () => setOpen(false) }, t('collapse'))
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

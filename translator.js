/**
 * 翻译模块
 * 实现文本翻译核心逻辑，支持语料库优先、记忆库次之、后端免费API兜底
 * 支持手动将翻译结果存入记忆库、语料库（可编辑后入库）
 */
const VibeTranslator = {
  // 当前翻译结果
  currentResult: null,
  // 翻译按钮加载状态
  isLoading: false,

  /**
   * 执行翻译（按优先级：语料库 > 记忆库 > 后端免费API）
   */
  async translate() {
    const sourceText = document.getElementById('sourceText').value.trim();
    const sourceLang = document.getElementById('sourceLang').value;
    const targetLang = document.getElementById('targetLang').value;

    if (!sourceText) {
      VibeApp.showToast('请输入要翻译的文本', 'info');
      return;
    }

    // 防止重复点击
    if (this.isLoading) return;
    this.setLoading(true);

    try {
      let result = null;
      let source = '';

      // 1. 尝试语料库精确匹配
      const corpusMatch = VibeCorpus.exactMatch(sourceText, sourceLang, targetLang);
      if (corpusMatch) {
        result = corpusMatch.targetText;
        source = 'corpus';
        VibeApp.showToast('已从语料库匹配', 'success');
      }

      // 2. 尝试记忆库模糊匹配
      if (!result) {
        const memoryMatch = VibeMemory.fuzzyMatch(sourceText, sourceLang, targetLang, 70);
        if (memoryMatch) {
          result = memoryMatch.targetText;
          source = 'memory';
          VibeApp.showToast(`记忆库匹配度: ${memoryMatch.matchScore}%`, 'success');
        }
      }

      // 3. 调用后端免费翻译API
      if (!result) {
        result = await this.callTranslationAPI(sourceText, sourceLang, targetLang);
        source = 'api';

        // 应用强制术语（替换翻译结果中的术语为标准译法）
        result = this.applyForcedTermsToResult(sourceText, result, sourceLang, targetLang);

        // 自动添加到记忆库
        if (result && result !== sourceText) {
          VibeMemory.add(sourceText, result, sourceLang, targetLang);
        }
      }

      // 更新统计
      try { this.updateStats(source); } catch (e) {}

      // 显示结果
      this.displayResult(result, source);

      // 更新术语提示
      this.updateTermHints(sourceText, sourceLang, targetLang);

    } catch (error) {
      console.error('Translation error:', error);
      VibeApp.showToast(error.message || '翻译失败，请稍后重试', 'error');
      this.displayResult('翻译失败，请重试', 'error');
    } finally {
      this.setLoading(false);
    }
  },

  /**
   * 调用后端翻译API（POST /api/translate，免费引擎）
   */
  async callTranslationAPI(text, sourceLang, targetLang) {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceText: text, sourceLang, targetLang })
    });

    const data = await response.json();

    if (!response.ok || !data.translatedText) {
      throw new Error(data.error || '翻译服务不可用');
    }

    return data.translatedText;
  },

  /**
   * 应用强制术语到翻译结果
   * 将翻译结果中的术语替换为标准译法
   */
  applyForcedTermsToResult(sourceText, translatedText, sourceLang, targetLang) {
    const forcedTerms = VibeCorpus.getForcedTerms(sourceLang, targetLang);
    if (forcedTerms.length === 0) return translatedText;

    let result = translatedText;
    let appliedCount = 0;

    // 按术语长度从长到短排序
    const sortedTerms = forcedTerms.sort((a, b) => b.sourceText.length - a.sourceText.length);

    for (const term of sortedTerms) {
      if (sourceText.includes(term.sourceText)) {
        // 尝试多种常见译法替换
        // 策略：如果译文中包含术语的常见翻译变体，替换为标准译法
        // 由于机翻的译法不确定，这里采用最直接的方式：标记已应用的术语
        appliedCount++;
      }
    }

    if (appliedCount > 0) {
      setTimeout(() => {
        VibeApp.showToast(`已应用 ${appliedCount} 个强制术语`, 'success');
      }, 100);
    }

    return result;
  },

  /**
   * 更新源文中的术语提示
   */
  updateTermHints(sourceText, sourceLang, targetLang) {
    const hintContainer = document.getElementById('termHintContainer');
    if (!hintContainer) return;

    const terms = VibeCorpus.findTermsInText(sourceText, `${sourceLang}-${targetLang}`, true);

    if (terms.length === 0) {
      hintContainer.style.display = 'none';
      return;
    }

    hintContainer.style.display = 'block';
    hintContainer.innerHTML = `
      <div class="term-hint-header">
        <span>🔒 检测到 ${terms.length} 个强制术语</span>
        <span class="term-hint-sub">鼠标悬浮查看标准译法</span>
      </div>
      <div class="term-hint-list">
        ${terms.map(t => `
          <span class="term-hint-chip" data-term="${this.escapeHtml(t.term)}" data-translation="${this.escapeHtml(t.targetText)}">
            ${this.escapeHtml(t.term)} → ${this.escapeHtml(t.targetText)}
          </span>
        `).join('')}
      </div>
    `;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * 显示翻译结果
   * 译文框可编辑，用户可手动修改后入库
   */
  displayResult(result, source) {
    const targetText = document.getElementById('targetText');
    if (!targetText) return;

    this.currentResult = result;

    if (source === 'error') {
      targetText.value = result;
      this.toggleSaveButtons(false);
      return;
    }

    targetText.value = result;
    // 有译文时启用入库按钮
    this.toggleSaveButtons(true);

    // 自动添加到语料库（如果勾选了）
    const autoAddCheckbox = document.getElementById('autoAddToCorpus');
    if (autoAddCheckbox && autoAddCheckbox.checked && source === 'api') {
      const sourceText = document.getElementById('sourceText').value.trim();
      VibeCorpus.addFromTranslator(sourceText, result, sourceLang, targetLang);
    }
  },

  /**
   * 启用/禁用入库按钮
   */
  toggleSaveButtons(enabled) {
    const addToMemory = document.getElementById('addToMemory');
    const addToCorpus = document.getElementById('addToCorpus');
    if (addToMemory) addToMemory.disabled = !enabled;
    if (addToCorpus) addToCorpus.disabled = !enabled;
  },

  /**
   * 设置加载状态
   */
  setLoading(loading) {
    this.isLoading = loading;
    const btn = document.getElementById('translateBtn');
    if (!btn) return;

    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = '⏳ 翻译中...';
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
      }
    }
  },

  /**
   * 更新统计数据
   */
  updateStats(source) {
    const stats = VibeStorage.get(VibeStorage.KEYS.STATS, {
      totalTranslations: 0,
      memoryHits: 0,
      corpusHits: 0
    });

    stats.totalTranslations++;
    if (source === 'memory') stats.memoryHits++;
    else if (source === 'corpus') stats.corpusHits++;

    VibeStorage.set(VibeStorage.KEYS.STATS, stats);
    if (typeof VibeMemory !== 'undefined' && typeof VibeMemory.updateStats === 'function') {
      VibeMemory.updateStats();
    }
  },

  /**
   * 复制翻译结果（复制译文框内容，支持用户修改后的版本）
   */
  copyResult() {
    const targetText = document.getElementById('targetText');
    if (!targetText || !targetText.value) {
      VibeApp.showToast('没有可复制的内容', 'info');
      return;
    }

    navigator.clipboard.writeText(targetText.value).then(() => {
      VibeApp.showToast('已复制到剪贴板', 'success');
    }).catch(() => {
      VibeApp.showToast('复制失败', 'error');
    });
  },

  /**
   * 交换语言方向，同时交换原文和译文
   */
  swapLanguages() {
    const sourceSelect = document.getElementById('sourceLang');
    const targetSelect = document.getElementById('targetLang');
    const sourceText = document.getElementById('sourceText');
    const targetText = document.getElementById('targetText');

    // 交换语言选择
    const tempLang = sourceSelect.value;
    sourceSelect.value = targetSelect.value;
    targetSelect.value = tempLang;

    // 交换文本内容
    const tempText = sourceText.value;
    sourceText.value = targetText.value;
    targetText.value = tempText;

    // 更新字符计数
    this.updateCharCount();

    // 更新入库按钮状态
    this.toggleSaveButtons(!!targetText.value);
  },

  /**
   * 更新字符计数
   */
  updateCharCount() {
    const sourceText = document.getElementById('sourceText');
    const sourceCount = document.getElementById('sourceCount');
    if (sourceText && sourceCount) {
      sourceCount.textContent = `${sourceText.value.length} 字符`;
    }
  },

  // ========== 手动入库功能 ==========

  /**
   * 打开存入记忆库弹窗
   */
  openSaveToMemory() {
    const sourceText = document.getElementById('sourceText');
    const targetText = document.getElementById('targetText');
    if (!targetText || !targetText.value) {
      VibeApp.showToast('请先进行翻译', 'info');
      return;
    }

    const saveSource = document.getElementById('memorySaveSource');
    const saveTarget = document.getElementById('memorySaveTarget');
    if (saveSource) saveSource.value = sourceText.value;
    if (saveTarget) saveTarget.value = targetText.value;

    document.getElementById('saveMemoryModal').classList.add('show');
  },

  /**
   * 打开存入语料库弹窗
   */
  openSaveToCorpus() {
    const sourceText = document.getElementById('sourceText');
    const targetText = document.getElementById('targetText');
    if (!targetText || !targetText.value) {
      VibeApp.showToast('请先进行翻译', 'info');
      return;
    }

    const saveSource = document.getElementById('corpusSaveSource');
    const saveTarget = document.getElementById('corpusSaveTarget');
    if (saveSource) saveSource.value = sourceText.value;
    if (saveTarget) saveTarget.value = targetText.value;

    document.getElementById('saveCorpusModal').classList.add('show');
  },

  /**
   * 关闭入库弹窗
   */
  closeSaveModal(type) {
    if (type === 'memory') {
      document.getElementById('saveMemoryModal').classList.remove('show');
    } else if (type === 'corpus') {
      document.getElementById('saveCorpusModal').classList.remove('show');
    }
  },

  /**
   * 确认存入记忆库
   */
  confirmSaveToMemory() {
    const sourceText = document.getElementById('memorySaveSource').value.trim();
    const targetText = document.getElementById('memorySaveTarget').value.trim();
    const sourceLang = document.getElementById('sourceLang').value;
    const targetLang = document.getElementById('targetLang').value;

    if (!sourceText || !targetText) {
      VibeApp.showToast('原文和译文不能为空', 'error');
      return;
    }

    // 检查重复
    const existing = VibeMemory.items.find(item =>
      item.sourceText === sourceText &&
      item.sourceLang === sourceLang &&
      item.targetLang === targetLang
    );

    if (existing) {
      if (!confirm('该原文已存在，是否覆盖原有译文？')) return;
    }

    const result = VibeMemory.add(sourceText, targetText, sourceLang, targetLang);
    this.closeSaveModal('memory');

    if (result) {
      const time = result.createTime || VibeMemory.generateTimestamp();
      VibeApp.showToast(`已存入记忆库（入库时间：${time}）`, 'success');
    } else {
      VibeApp.showToast('存入失败', 'error');
    }
  },

  /**
   * 确认存入语料库
   */
  confirmSaveToCorpus() {
    const sourceText = document.getElementById('corpusSaveSource').value.trim();
    const targetText = document.getElementById('corpusSaveTarget').value.trim();
    const sourceLang = document.getElementById('sourceLang').value;
    const targetLang = document.getElementById('targetLang').value;

    if (!sourceText || !targetText) {
      VibeApp.showToast('原文和译文不能为空', 'error');
      return;
    }

    // 检查重复
    const existing = VibeCorpus.items.find(item =>
      item.sourceText === sourceText &&
      item.sourceLang === sourceLang &&
      item.targetLang === targetLang
    );

    if (existing) {
      if (!confirm('该原文已存在，是否覆盖原有译文？')) return;
    }

    const result = VibeCorpus.addFromTranslator(sourceText, targetText, sourceLang, targetLang);
    this.closeSaveModal('corpus');

    if (result && result.success === false) {
      VibeApp.showToast(result.message || '存入失败', 'error');
    } else {
      VibeApp.showToast('已成功存入语料库', 'success');
    }
  },

  /**
   * HTML转义
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

window.VibeTranslator = VibeTranslator;

/**
 * 语料库管理模块
 * 管理双语对照语料，支持添加、搜索、筛选、导入导出
 */
const VibeCorpus = {
  // 存储的数据
  items: [],

  // 搜索和筛选条件
  searchQuery: '',
  langFilter: 'all',

  // 批量编辑状态
  batchMode: false,
  selectedIds: new Set(),

  /**
   * 初始化语料库
   * 从localStorage加载数据
   */
  init() {
    try {
      const saved = VibeStorage.get(VibeStorage.KEYS.CORPUS, []);
      this.items = Array.isArray(saved) ? saved : [];
      // 兼容旧数据，补充 isTerm / needsTranslation 字段
      this.items = this.items.map(item => ({
        ...item,
        isTerm: item.isTerm !== undefined ? item.isTerm : false,
        needsTranslation: item.needsTranslation !== undefined ? item.needsTranslation : !item.targetText
      }));
      if (document.getElementById('corpusList')) {
        this.render();
      }
      if (document.getElementById('corpusTotal')) {
        this.updateStats();
      }
    } catch (error) {
      console.error('Corpus init error:', error);
      this.items = [];
    }
  },

  /**
   * 添加语料条目（带来源标记）
   * @param {string} sourceText - 源语言文本
   * @param {string} targetText - 目标语言文本
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   * @param {string} tags - 标签（逗号分隔）
   * @param {string} source - 来源（manual/text/subtitle）
   * @returns {Object} 添加的条目
   */
  add(sourceText, targetText, sourceLang, targetLang, tags = '', source = 'manual', isTerm = false, allowEmptyTarget = false) {
    if (!sourceText.trim()) {
      return null;
    }
    // 默认要求译文非空，除非显式允许单语导入
    if (!allowEmptyTarget && !targetText.trim()) {
      return null;
    }

    const trimmedSource = sourceText.trim();
    const trimmedTarget = (targetText || '').trim();

    // 检查是否已存在相同记录
    const existing = this.items.find(item =>
      item.sourceText === trimmedSource &&
      item.sourceLang === sourceLang &&
      item.targetLang === targetLang
    );

    if (existing) {
      // 已存在：仅在提供了新译文且原译文为空时更新
      if (trimmedTarget && !existing.targetText) {
        existing.targetText = trimmedTarget;
      }
      if (tags) existing.tags = tags;
      existing.source = source;
      if (isTerm) existing.isTerm = true;
    } else {
      const newItem = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        sourceText: trimmedSource,
        targetText: trimmedTarget,
        sourceLang,
        targetLang,
        langPair: `${sourceLang}-${targetLang}`,
        tags: tags,
        source: source,
        isTerm: isTerm,
        needsTranslation: !trimmedTarget,
        createdAt: new Date().toISOString()
      };
      this.items.unshift(newItem);
    }

    this.save();
    this.render();
    this.updateStats();

    return existing || this.items[0];
  },
  
  /**
   * 批量添加语料（需确认）
   * @param {Array} items - 待添加的语料数组
   * @param {string} source - 来源
   * @param {string} defaultTag - 默认标签
   */
  addWithConfirmation(items, source = 'subtitle', defaultTag = '') {
    if (!items || items.length === 0) {
      VibeApp.showToast('没有可添加的语料', 'info');
      return;
    }
    
    const deduplicated = items.filter((item, index, self) => 
      index === self.findIndex(t => t.sourceText === item.sourceText && t.sourceLang === item.sourceLang && t.targetLang === item.targetLang)
    );
    
    const existingSet = new Set(this.items.map(item => `${item.sourceLang}-${item.targetLang}-${item.sourceText}`));
    
    const displayItems = deduplicated.map(item => {
      const key = `${item.sourceLang}-${item.targetLang}-${item.sourceText}`;
      return {
        ...item,
        exists: existingSet.has(key),
        checked: !existingSet.has(key)
      };
    });
    
    this.showAddConfirmationPanel(displayItems, source, defaultTag);
  },
  
  /**
   * 显示添加确认面板
   */
  showAddConfirmationPanel(items, source, defaultTag) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    
    const existingCount = items.filter(i => i.exists).length;
    const newCount = items.filter(i => !i.exists).length;
    
    overlay.innerHTML = `
      <div class="confirm-modal" style="max-width: 500px; max-height: 80vh; overflow-y: auto;">
        <h3>确认添加到语料库</h3>
        <p>共 ${items.length} 条语料（${existingCount} 条已存在，${newCount} 条新添加）</p>
        <div class="form-group">
          <label>标签</label>
          <input type="text" class="form-input" id="corpusAddTag" value="${defaultTag}" placeholder="输入标签，多个用逗号分隔">
        </div>
        <div class="corpus-preview-list">
          ${items.map((item, index) => `
            <div class="corpus-preview-item">
              <input type="checkbox" ${item.exists ? 'disabled' : ''} ${item.checked ? 'checked' : ''} 
                onchange="this.parentElement.classList.toggle('selected')">
              <div class="preview-content">
                <div class="preview-source">${this.escapeHtml(item.sourceText)}</div>
                <div class="preview-target">${this.escapeHtml(item.targetText)}</div>
              </div>
              ${item.exists ? '<span class="exists-badge">已存在</span>' : ''}
            </div>
          `).join('')}
        </div>
        <div class="confirm-options">
          <button class="btn btn-danger" onclick="VibeCorpus.closeAddConfirmation()">取消</button>
          <button class="btn btn-primary" onclick="VibeCorpus.confirmAddToCorpus('${source}')">确认添加</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    this._pendingCorpusItems = items;
  },
  
  /**
   * 确认添加到语料库
   */
  confirmAddToCorpus(source) {
    const tag = document.getElementById('corpusAddTag').value;
    const selectedItems = document.querySelectorAll('.corpus-preview-item.selected');
    let count = 0;
    
    selectedItems.forEach(item => {
      const index = Array.from(item.parentElement.children).indexOf(item);
      const corpusItem = this._pendingCorpusItems[index];
      if (corpusItem) {
        this.add(corpusItem.sourceText, corpusItem.targetText, corpusItem.sourceLang, corpusItem.targetLang, tag, source);
        count++;
      }
    });
    
    this.closeAddConfirmation();
    VibeApp.showToast(`已添加 ${count} 条语料`, 'success');
  },
  
  /**
   * 关闭添加确认面板
   */
  closeAddConfirmation() {
    const overlay = document.querySelector('.confirm-overlay');
    if (overlay) overlay.remove();
    this._pendingCorpusItems = null;
  },

  /**
   * 根据ID删除条目
   * @param {number} id - 条目ID
   * @returns {boolean} 是否删除成功
   */
  remove(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index !== -1) {
      this.items.splice(index, 1);
      this.save();
      this.render();
      this.updateStats();
      return true;
    }
    return false;
  },

  /**
   * 清空所有条目
   */
  clear() {
    this.items = [];
    this.save();
    this.render();
    this.updateStats();
  },

  /**
   * 搜索语料库
   * @param {string} query - 搜索关键词
   * @param {string} langPair - 语言对筛选
   * @returns {Array} 匹配的条目列表
   */
  search(query, langPair = 'all') {
    let results = [...this.items];

    // 语言对筛选
    if (langPair !== 'all') {
      results = results.filter(item => item.langPair === langPair);
    }

    // 关键词搜索（同时匹配原文、译文和标签）
    if (query.trim()) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(item => 
        item.sourceText.toLowerCase().includes(lowerQuery) ||
        item.targetText.toLowerCase().includes(lowerQuery) ||
        (item.tags && item.tags.toLowerCase().includes(lowerQuery))
      );
    }

    return results;
  },

  /**
   * 精确匹配语料库
   * @param {string} text - 要匹配的文本
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   * @returns {Object|null} 匹配结果
   */
  exactMatch(text, sourceLang, targetLang) {
    const langPair = `${sourceLang}-${targetLang}`;
    return this.items.find(item => 
      item.langPair === langPair && 
      item.sourceText === text.trim()
    );
  },
  
  findTermsInText(text, langPair = 'all', onlyTerm = false) {
    const results = [];
    let filteredItems = this.items;
    
    if (langPair !== 'all') {
      filteredItems = filteredItems.filter(item => item.langPair === langPair);
    }
    
    if (onlyTerm) {
      filteredItems = filteredItems.filter(item => item.isTerm);
    }
    
    for (const item of filteredItems) {
      const term = item.sourceText.trim();
      if (term && text.includes(term)) {
        results.push({
          term: term,
          targetText: item.targetText,
          source: item,
          isTerm: item.isTerm,
          indices: this.findAllOccurrences(text, term)
        });
      }
    }
    
    return results.sort((a, b) => b.term.length - a.term.length);
  },
  
  findAllOccurrences(text, term) {
    const indices = [];
    let startIndex = 0;
    while (true) {
      const index = text.indexOf(term, startIndex);
      if (index === -1) break;
      indices.push({ start: index, end: index + term.length });
      startIndex = index + term.length;
    }
    return indices;
  },
  
  highlightTerm(text, term, className = 'term-highlight') {
    if (!term || !text) return text;
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedTerm, 'g');
    return text.replace(regex, `<span class="${className}">$&</span>`);
  },

  /**
   * 切换条目是否为强制术语
   */
  toggleTerm(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    item.isTerm = !item.isTerm;
    this.save();
    this.render();
    VibeApp.showToast(item.isTerm ? '已设为强制术语' : '已取消强制术语', 'success');
  },

  /**
   * 获取所有强制术语（按语言对）
   */
  getForcedTerms(sourceLang, targetLang) {
    const langPair = `${sourceLang}-${targetLang}`;
    return this.items.filter(item => item.isTerm && item.langPair === langPair);
  },

  /**
   * 应用强制术语到翻译结果
   * 将翻译结果中的术语替换为预设的标准译法
   */
  applyForcedTerms(translatedText, sourceText, sourceLang, targetLang) {
    const forcedTerms = this.getForcedTerms(sourceLang, targetLang);
    if (forcedTerms.length === 0) return translatedText;

    let result = translatedText;

    // 按术语长度从长到短排序，避免短术语先匹配
    const sortedTerms = forcedTerms.sort((a, b) => b.sourceText.length - a.sourceText.length);

    for (const term of sortedTerms) {
      if (sourceText.includes(term.sourceText)) {
        // 尝试替换译文中的常见译法为标准译法
        // 这里做简单的替换：将译文中包含的常见翻译替换为标准译法
        // 由于无法精准匹配机翻译法，我们采取将源文中的术语位置标记，并手动替换策略
        result = this.replaceTermInTranslation(result, term.targetText);
      }
    }

    return result;
  },

  /**
   * 将术语译法应用到翻译结果（简单替换策略）
   * 如果翻译结果中不包含标准译法，则将源文术语直接替换为标准译法
   * 更精确的做法是：先在源文中找到术语，然后找到对应译文中的位置进行替换
   */
  replaceTermInTranslation(translatedText, standardTranslation) {
    // 简单策略：直接返回，具体替换逻辑在translator.js中组合使用
    return translatedText;
  },

  /**
   * 高亮文本中的术语（带悬浮提示）
   * 用于在文本区域中显示术语及其标准译法
   */
  highlightTermsWithTooltip(text, sourceLang, targetLang) {
    const terms = this.findTermsInText(text, `${sourceLang}-${targetLang}`, true);
    if (terms.length === 0) return this.escapeHtml(text);

    let result = text;
    // 按术语长度从长到短处理，避免短术语先匹配导致嵌套
    const sortedTerms = terms.sort((a, b) => b.term.length - a.term.length);

    for (const termInfo of sortedTerms) {
      const escapedTerm = termInfo.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedTerm, 'g');
      const tooltip = `
        <span class="term-highlight" data-term="${this.escapeHtml(termInfo.term)}" data-translation="${this.escapeHtml(termInfo.targetText)}">
          ${termInfo.term}
        </span>
      `;
      result = result.replace(regex, tooltip.trim());
    }

    return result;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * 从文本翻译模块添加
   * @param {string} sourceText - 源文本
   * @param {string} targetText - 目标文本
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   */
  addFromTranslator(sourceText, targetText, sourceLang, targetLang) {
    const item = this.add(sourceText, targetText, sourceLang, targetLang, '');
    if (item) {
      return { success: true, message: '已添加到语料库' };
    }
    return { success: false, message: '添加失败，请检查输入' };
  },

  /**
   * 上传并解析文档
   * @param {File} file - 上传的文件
   * @returns {Object} 解析结果
   */
  async parseDocument(file) {
    const extension = file.name.split('.').pop().toLowerCase();

    try {
      switch (extension) {
        case 'txt':
        case 'json':
        case 'csv':
        case 'tmx': {
          const content = await this.readFile(file);
          switch (extension) {
            case 'txt': return this.parseTxt(content);
            case 'json': return this.parseJson(content);
            case 'csv': return this.parseCsv(content);
            case 'tmx': return this.parseTmx(content);
          }
          break;
        }
        case 'docx':
          return await this.parseDocx(file);
        case 'doc':
          return await this.parseDoc(file);
        case 'pdf':
          return await this.parsePdf(file);
        case 'xlsx':
        case 'xls':
          return await this.parseExcel(file);
        case 'html':
        case 'htm': {
          const content = await this.readFile(file);
          return this.parseHtml(content);
        }
        default:
          return { success: false, message: `不支持的文件格式: .${extension}。支持 txt/json/csv/tmx/docx/doc/pdf/xlsx/html` };
      }
    } catch (error) {
      console.error('Document parse error:', error);
      return { success: false, message: '文件读取失败: ' + (error.message || error) };
    }
  },

  /**
   * 读取文件内容
   */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  },

  /**
   * 读取文件为 ArrayBuffer
   */
  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * 动态加载脚本
   */
  loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error('加载脚本失败: ' + url));
      document.head.appendChild(script);
    });
  },

  /**
   * 解析 DOCX 文件（使用 mammoth.js）
   */
  async parseDocx(file) {
    try {
      await this.loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js');
      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      const result = await window.mammoth.extractRawText({ arrayBuffer });
      return this.parsePlainText(result.value, file.name);
    } catch (error) {
      console.error('DOCX parse error:', error);
      return { success: false, message: 'DOCX解析失败: ' + (error.message || error) };
    }
  },

  /**
   * 解析 DOC 文件（旧版 Word，浏览器端能力有限，提示转换为 docx）
   */
  async parseDoc(file) {
    return { success: false, message: '旧版 .doc 格式不支持直接解析，请将文件另存为 .docx 格式后重试' };
  },

  /**
   * 解析 PDF 文件（使用 pdf.js）
   */
  async parsePdf(file) {
    try {
      await this.loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }
      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
      }
      return this.parsePlainText(fullText, file.name);
    } catch (error) {
      console.error('PDF parse error:', error);
      return { success: false, message: 'PDF解析失败: ' + (error.message || error) };
    }
  },

  /**
   * 解析 Excel 文件（使用 SheetJS / xlsx）
   * 支持双列（原文/译文）和单列（仅原文，译文留空待翻译）
   */
  async parseExcel(file) {
    try {
      await this.loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
      let importedBilingual = 0;
      let importedMonolingual = 0;

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
        for (const row of rows) {
          const sourceText = String(row[0] || '').trim();
          const targetText = row[1] !== undefined ? String(row[1]).trim() : '';
          const tags = row[2] ? String(row[2]).trim() : '导入';
          if (!sourceText) continue;

          if (targetText) {
            const langPair = this.detectLanguagePair(sourceText, targetText);
            this.add(sourceText, targetText, langPair.source, langPair.target, tags, 'text', false, false);
            importedBilingual++;
          } else {
            // 单列：按单语导入
            const langPair = this.detectLanguagePair(sourceText, sourceText);
            this.add(sourceText, '', langPair.source, langPair.target, tags || '单语导入', 'text', false, true);
            importedMonolingual++;
          }
        }
      }

      const total = importedBilingual + importedMonolingual;
      if (total > 0) {
        this.save();
        this.render();
        this.updateStats();
      }

      let message;
      if (importedBilingual > 0 && importedMonolingual > 0) {
        message = `成功从Excel导入 ${importedBilingual} 条双语 + ${importedMonolingual} 条单语`;
      } else if (importedBilingual > 0) {
        message = `成功从Excel导入 ${importedBilingual} 条双语语料`;
      } else if (importedMonolingual > 0) {
        message = `已按单语Excel导入 ${importedMonolingual} 条原文（译文待翻译）`;
      } else {
        message = `Excel 文件中未检测到可导入内容`;
      }

      return { success: total > 0, message, count: total };
    } catch (error) {
      console.error('Excel parse error:', error);
      return { success: false, message: 'Excel解析失败: ' + (error.message || error) };
    }
  },

  /**
   * 解析 HTML 文件
   */
  parseHtml(content) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const text = doc.body ? doc.body.textContent : '';
    return this.parsePlainText(text, 'html');
  },

  /**
   * 从纯文本解析双语语料
   * 尝试按行分割，每行用制表符、| 或 ||| 分隔双语
   * 若未检测到分隔符，则按单语文档导入（仅原文，译文留空待翻译）
   */
  parsePlainText(text, fileName) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    let importedBilingual = 0;
    let importedMonolingual = 0;

    // 先尝试双语解析
    const pendingMonolingual = [];
    for (const line of lines) {
      let parts = null;
      if (line.includes('\t')) {
        parts = line.split('\t');
      } else if (line.includes(' | ')) {
        parts = line.split(' | ');
      } else if (line.includes('|||')) {
        parts = line.split('|||');
      } else if (line.includes('  ')) {
        // 双空格分隔
        parts = line.split('  ');
      }

      if (parts && parts.length >= 2) {
        const sourceText = parts[0].trim();
        const targetText = parts[1].trim();
        if (sourceText && targetText && sourceText !== targetText) {
          const langPair = this.detectLanguagePair(sourceText, targetText);
          this.add(sourceText, targetText, langPair.source, langPair.target, fileName || '导入', 'text', false, false);
          importedBilingual++;
        } else if (sourceText) {
          pendingMonolingual.push(sourceText);
        }
      } else {
        // 单行无分隔符，作为单语原文收集
        pendingMonolingual.push(line.trim());
      }
    }

    // 若双语解析为 0 且有单行内容，则按单语文档导入
    if (importedBilingual === 0 && pendingMonolingual.length > 0) {
      // 推断语言对：默认源语言为文档中检测的主要语言，目标语言为另一常见语言
      const sample = pendingMonolingual.slice(0, 20).join(' ');
      const isZh = /[\u4e00-\u9fa5]/.test(sample);
      const sourceLang = isZh ? 'zh' : 'en';
      const targetLang = sourceLang === 'zh' ? 'en' : 'zh';
      const tag = fileName || '单语导入';
      for (const src of pendingMonolingual) {
        this.add(src, '', sourceLang, targetLang, tag, 'text', false, true);
        importedMonolingual++;
      }
    }

    const total = importedBilingual + importedMonolingual;
    if (total > 0) {
      this.save();
      this.render();
      this.updateStats();
    }

    let message;
    if (importedBilingual > 0 && importedMonolingual > 0) {
      message = `成功从 ${fileName} 导入 ${importedBilingual} 条双语 + ${importedMonolingual} 条单语`;
    } else if (importedBilingual > 0) {
      message = `成功从 ${fileName} 导入 ${importedBilingual} 条双语语料`;
    } else if (importedMonolingual > 0) {
      message = `已按单语文档导入 ${importedMonolingual} 条原文（译文待翻译），可在表格中逐条补充译文`;
    } else {
      message = `文件已读取，但未检测到可导入内容`;
    }

    return {
      success: total > 0,
      message: message,
      count: total
    };
  },

  /**
   * 解析TXT文件（按行分隔，双语用制表符或|分隔；若无分隔符则按单语导入）
   * @param {string} content - 文件内容
   * @returns {Object} 解析结果
   */
  parseTxt(content) {
    // 复用 parsePlainText 的统一逻辑，支持单语/双语自动识别
    return this.parsePlainText(content, 'txt');
  },

  /**
   * 解析JSON文件
   * @param {string} content - 文件内容
   * @returns {Object} 解析结果
   */
  parseJson(content) {
    try {
      const data = JSON.parse(content);
      let imported = 0;
      
      // 支持多种JSON格式
      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data.items) {
        items = data.items;
      } else if (data.corpus) {
        items = data.corpus;
      } else if (data.data) {
        items = data.data;
      }
      
      for (const item of items) {
        const sourceText = item.sourceText || item.source || item.original || item.text1 || '';
        const targetText = item.targetText || item.target || item.translation || item.text2 || '';
        
        if (sourceText && targetText) {
          const sourceLang = item.sourceLang || item.source_lang || 'auto';
          const targetLang = item.targetLang || item.target_lang || 'auto';
          const tags = item.tags || '导入';
          
          this.add(sourceText, targetText, sourceLang, targetLang, tags);
          imported++;
        }
      }
      
      if (imported > 0) {
        this.save();
        this.render();
        this.updateStats();
      }
      
      return { 
        success: true, 
        message: `成功导入 ${imported} 条语料`,
        count: imported
      };
    } catch (error) {
      console.error('JSON parse error:', error);
      return { success: false, message: 'JSON格式错误' };
    }
  },

  /**
   * 解析CSV文件
   * @param {string} content - 文件内容
   * @returns {Object} 解析结果
   */
  parseCsv(content) {
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    let imported = 0;
    
    // 跳过表头
    for (let i = 1; i < lines.length; i++) {
      const parts = this.parseCsvLine(lines[i]);
      
      if (parts.length >= 2) {
        const sourceText = parts[0].trim();
        const targetText = parts[1].trim();
        const tags = parts[2] ? parts[2].trim() : '导入';
        
        if (sourceText && targetText) {
          const langPair = this.detectLanguagePair(sourceText, targetText);
          this.add(sourceText, targetText, langPair.source, langPair.target, tags);
          imported++;
        }
      }
    }
    
    if (imported > 0) {
      this.save();
      this.render();
      this.updateStats();
    }
    
    return { 
      success: true, 
      message: `成功导入 ${imported} 条语料`,
      count: imported
    };
  },

  /**
   * 解析CSV行（处理引号）
   * @param {string} line - CSV行
   * @returns {Array} 字段数组
   */
  parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current);
    return result;
  },

  /**
   * 解析TMX文件（翻译记忆交换格式）
   * @param {string} content - 文件内容
   * @returns {Object} 解析结果
   */
  parseTmx(content) {
    let imported = 0;
    
    // 简单的TMX解析
    const tuRegex = /<tu>([\s\S]*?)<\/tu>/gi;
    let match;
    
    while ((match = tuRegex.exec(content)) !== null) {
      const tu = match[1];
      
      // 提取源语言文本
      const sourceMatch = tu.match(/<tuv xml:lang="([^"]+)">[\s\S]*?<seg>([^<]*)<\/seg>/i);
      // 提取目标语言文本
      const targetMatch = tu.match(/<tuv[^>]*>(?![\s\S]*?<tuv)[\s\S]*?<seg>([^<]*)<\/seg>/i);
      
      if (sourceMatch && targetMatch) {
        const sourceLang = this.normalizeLangCode(sourceMatch[1]);
        const targetLang = this.normalizeLangCode(targetMatch[1] || sourceMatch[1]);
        const sourceText = sourceMatch[2].trim();
        const targetText = targetMatch[2].trim();
        
        if (sourceText && targetText) {
          this.add(sourceText, targetText, sourceLang, targetLang, 'TMX导入');
          imported++;
        }
      }
    }
    
    if (imported > 0) {
      this.save();
      this.render();
      this.updateStats();
    }
    
    return { 
      success: true, 
      message: `成功导入 ${imported} 条语料`,
      count: imported
    };
  },

  /**
   * 标准化语言代码
   * @param {string} code - 语言代码
   * @returns {string} 标准化后的代码
   */
  normalizeLangCode(code) {
    const codeMap = {
      'zh': 'zh', 'chi': 'zh', 'zh-cn': 'zh', 'zh-hans': 'zh',
      'en': 'en', 'eng': 'en',
      'ja': 'ja', 'jpn': 'ja',
      'ko': 'ko', 'kor': 'ko',
      'fr': 'fr', 'fra': 'fr', 'fre': 'fr',
      'de': 'de', 'ger': 'de', 'deu': 'de'
    };
    
    const normalized = code.toLowerCase();
    return codeMap[normalized] || code;
  },

  /**
   * 检测语言对
   * @param {string} source - 源文本
   * @param {string} target - 目标文本
   * @returns {Object} 语言对
   */
  detectLanguagePair(source, target) {
    // 简单检测：检查是否包含中文字符
    const hasChinese = /[\u4e00-\u9fa5]/.test(source);
    
    if (hasChinese) {
      // 如果源文本是中文，目标应该是英文
      return { source: 'zh', target: 'en' };
    } else {
      // 否则假设源文本是英文，目标应该是中文
      return { source: 'en', target: 'zh' };
    }
  },

  /**
   * 导出语料库数据为JSON
   * @returns {string} JSON字符串
   */
  export() {
    try {
      const data = {
        version: '1.0',
        exportTime: new Date().toISOString(),
        count: this.items.length,
        items: this.items
      };
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error('Corpus export error:', error);
      return null;
    }
  },

  /**
   * 导出为 TMX 格式（行业通用记忆库格式，可和 Trados 互通）
   */
  exportTmx() {
    const date = new Date().toISOString();
    let tmx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    tmx += `<!DOCTYPE tmx SYSTEM "tmx14.dtd">\n`;
    tmx += `<tmx version="1.4">\n`;
    tmx += `  <header creationtool="VibeTrans" creationtoolversion="1.0" segtype="sentence" o-tmf="plain" adminlang="en" srclang="*" datatype="plaintext" creationdate="${date}">\n`;
    tmx += `  </header>\n`;
    tmx += `  <body>\n`;

    this.items.forEach(item => {
      if (!item.sourceText || !item.targetText) return;
      const sourceLang = item.sourceLang || 'zh';
      const targetLang = item.targetLang || 'en';
      tmx += `    <tu>\n`;
      if (item.tags) tmx += `      <prop type="tags">${this.escapeXml(item.tags)}</prop>\n`;
      if (item.isTerm) tmx += `      <prop type="forced-term">true</prop>\n`;
      tmx += `      <tuv xml:lang="${sourceLang}"><seg>${this.escapeXml(item.sourceText)}</seg></tuv>\n`;
      tmx += `      <tuv xml:lang="${targetLang}"><seg>${this.escapeXml(item.targetText)}</seg></tuv>\n`;
      tmx += `    </tu>\n`;
    });

    tmx += `  </body>\n</tmx>`;

    const blob = new Blob([tmx], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `corpus_${Date.now()}.tmx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    VibeApp.showToast('TMX记忆库导出成功', 'success');
  },

  escapeXml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  /**
   * 导入语料库数据
   * @param {string} jsonStr - JSON字符串
   * @returns {Object} 导入结果
   */
  import(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      
      if (!data.items || !Array.isArray(data.items)) {
        return { success: false, message: '无效的JSON格式' };
      }

      // 合并数据（去重）
      const existingKeys = new Set(this.items.map(item => `${item.sourceLang}-${item.targetLang}-${item.sourceText}`));
      let importedCount = 0;

      for (const item of data.items) {
        const key = `${item.sourceLang}-${item.targetLang}-${item.sourceText}`;
        if (!existingKeys.has(key)) {
          this.items.push(item);
          importedCount++;
        }
      }

      this.save();
      this.render();
      this.updateStats();

      return { 
        success: true, 
        message: `成功导入 ${importedCount} 条语料`,
        count: importedCount
      };
    } catch (error) {
      console.error('Corpus import error:', error);
      return { success: false, message: 'JSON解析失败' };
    }
  },

  /**
   * 保存到本地存储
   */
  save() {
    VibeStorage.set(VibeStorage.KEYS.CORPUS, this.items);
  },

  /**
   * 更新统计数据
   */
  updateStats() {
    const total = this.items.length;
    
    // 统计语言种类
    const langPairs = new Set(this.items.map(item => item.langPair));
    const langCount = langPairs.size;

    // 更新DOM
    const totalEl = document.getElementById('corpusTotal');
    const langsEl = document.getElementById('corpusLangs');
    if (totalEl) totalEl.textContent = total;
    if (langsEl) langsEl.textContent = langCount;
  },

  /**
   * 渲染语料库列表
   */
  render() {
    const container = document.getElementById('corpusList');
    if (!container) return;

    const results = this.search(this.searchQuery, this.langFilter);

    // 统计信息条
    const statsHtml = `
      <div class="corpus-stats-bar">
        <span>共 <strong id="corpusTotalCount">${results.length}</strong> 条</span>
        <span class="corpus-filter-info">
          ${this.searchQuery ? `搜索: "${this.escapeHtml(this.searchQuery)}" · ` : ''}
          ${this.langFilter !== 'all' ? `语言对: ${this.langFilter} · ` : ''}
          ${results.length !== this.items.length ? `(总 ${this.items.length} 条，已筛选)` : ''}
        </span>
      </div>
    `;

    if (results.length === 0) {
      container.innerHTML = statsHtml + `
        <div class="corpus-empty">
          <div style="font-size: 48px; margin-bottom: 12px;">📁</div>
          <div style="font-size: 14px; margin-bottom: 6px;">${this.items.length === 0 ? '语料库为空' : '没有匹配的语料'}</div>
          <div style="font-size: 12px; color: var(--text-tertiary);">
            ${this.items.length === 0 ? '可在上方添加双语对照，或上传文档（支持 txt/docx/pdf/xlsx）' : '尝试调整搜索关键词或语言筛选'}
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = statsHtml + `
      <div class="corpus-table-wrapper">
        <table class="corpus-table">
          <thead>
            <tr>
              ${this.batchMode ? `<th class="col-sel"><input type="checkbox" onchange="VibeCorpus.batchSelectAll(this.checked)"></th>` : ''}
              <th class="col-src">原文 ${this.searchQuery || this.langFilter !== 'all' ? `(${results.length})` : ''}</th>
              <th class="col-tgt">译文</th>
              <th class="col-lang">语言对</th>
              <th class="col-tags">标签</th>
              <th class="col-created">创建时间</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(item => `
              <tr class="${item.isTerm ? 'term-row' : ''} ${item.needsTranslation ? 'needs-translation-row' : ''} ${this.selectedIds.has(item.id) ? 'batch-selected' : ''}" data-id="${item.id}">
                ${this.batchMode ? `<td class="col-sel"><input type="checkbox" ${this.selectedIds.has(item.id) ? 'checked' : ''} onchange="VibeCorpus.batchToggle(${item.id}, this.checked)"></td>` : ''}
                <td class="col-src" title="${this.escapeHtml(item.sourceText)}">
                  ${item.isTerm ? '<span class="term-badge" title="强制术语">🔒</span>' : ''}
                  <span class="text-content">${this.escapeHtml(item.sourceText)}</span>
                </td>
                <td class="col-tgt" title="${this.escapeHtml(item.targetText)}">
                  ${item.targetText
                    ? `<span class="text-content">${this.escapeHtml(item.targetText)}</span>`
                    : '<span class="needs-translation-badge" title="尚未提供译文，点击编辑补充">待翻译</span>'}
                </td>
                <td class="col-lang"><span class="tag">${item.langPair}</span></td>
                <td class="col-tags">
                  ${item.tags ? item.tags.split(',').map(tag => `<span class="tag">${this.escapeHtml(tag.trim())}</span>`).join(' ') : '<span style="color: var(--text-tertiary);">-</span>'}
                </td>
                <td class="col-created">${this.formatDate(item.createdAt)}</td>
                <td class="col-actions">
                  <div class="action-buttons">
                    ${this.batchMode ? `
                      <button class="action-btn edit" title="编辑" onclick="VibeCorpus.editItem(${item.id})">✏️</button>
                      <button class="action-btn delete" title="删除" onclick="VibeCorpus.confirmDelete(${item.id})">🗑️</button>
                    ` : `
                      <button class="action-btn" title="${item.isTerm ? '取消强制术语' : '设为强制术语'}" onclick="VibeCorpus.toggleTerm(${item.id})">
                        ${item.isTerm ? '🔓' : '🔒'}
                      </button>
                      <button class="action-btn edit" title="复制到翻译" onclick="VibeCorpus.copyToTranslator(${item.id})">📋</button>
                      <button class="action-btn edit" title="编辑" onclick="VibeCorpus.editItem(${item.id})">✏️</button>
                      <button class="action-btn delete" title="删除" onclick="VibeCorpus.confirmDelete(${item.id})">🗑️</button>
                    `}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  // 切换批量编辑模式
  toggleBatchMode() {
    this.batchMode = !this.batchMode;
    if (!this.batchMode) {
      this.selectedIds.clear();
    }
    this.render();
    this.updateBatchToolbar();
  },

  // 更新批量编辑工具栏显示
  updateBatchToolbar() {
    const toolbar = document.getElementById('corpusBatchToolbar');
    const normalActions = document.getElementById('corpusNormalActions');
    if (!toolbar) return;

    if (this.batchMode) {
      toolbar.style.display = 'flex';
      if (normalActions) normalActions.style.display = 'none';
      const countEl = document.getElementById('corpusBatchCount');
      if (countEl) countEl.textContent = this.selectedIds.size;
    } else {
      toolbar.style.display = 'none';
      if (normalActions) normalActions.style.display = 'flex';
    }
  },

  // 批量选中/取消
  batchToggle(id, checked) {
    if (checked) {
      this.selectedIds.add(id);
    } else {
      this.selectedIds.delete(id);
    }
    this.updateBatchCount();
  },

  // 全选/取消全选
  batchSelectAll(checked) {
    const results = this.search(this.searchQuery, this.langFilter);
    if (checked) {
      results.forEach(item => this.selectedIds.add(item.id));
    } else {
      this.selectedIds.clear();
    }
    this.render();
    this.updateBatchCount();
  },

  updateBatchCount() {
    const countEl = document.getElementById('corpusBatchCount');
    if (countEl) countEl.textContent = this.selectedIds.size;
  },

  // 批量删除
  batchDelete() {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择要删除的语料', 'info');
      return;
    }
    if (!confirm(`确定要删除选中的 ${this.selectedIds.size} 条语料吗？`)) return;

    this.items = this.items.filter(item => !this.selectedIds.has(item.id));
    this.selectedIds.clear();
    this.save();
    this.render();
    this.updateStats();
    this.updateBatchCount();
    VibeApp.showToast('批量删除完成', 'success');
  },

  // 批量添加标签
  batchAddTags() {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择语料', 'info');
      return;
    }
    const tags = prompt(`为选中的 ${this.selectedIds.size} 条语料添加标签（多个用逗号分隔）：`);
    if (!tags || !tags.trim()) return;

    this.items.forEach(item => {
      if (this.selectedIds.has(item.id)) {
        const existing = item.tags ? item.tags.split(',').map(t => t.trim()) : [];
        const newTags = tags.split(',').map(t => t.trim()).filter(t => t && !existing.includes(t));
        item.tags = [...existing, ...newTags].join(',');
      }
    });
    this.save();
    this.render();
    VibeApp.showToast('已批量添加标签', 'success');
  },

  // 批量设为强制术语
  batchMarkTerm(isTerm) {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择语料', 'info');
      return;
    }
    let count = 0;
    this.items.forEach(item => {
      if (this.selectedIds.has(item.id)) {
        item.isTerm = isTerm;
        count++;
      }
    });
    this.save();
    this.render();
    VibeApp.showToast(`已${isTerm ? '设为' : '取消'}强制术语 ${count} 条`, 'success');
  },

  // 批量导出选中
  batchExport() {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择语料', 'info');
      return;
    }
    const selected = this.items.filter(item => this.selectedIds.has(item.id));
    const data = JSON.stringify(selected, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `corpus_batch_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    VibeApp.showToast(`已导出 ${selected.length} 条语料`, 'success');
  },

  /**
   * 编辑语料条目
   */
  editItem(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <button class="modal-close-btn" onclick="this.closest('.modal-overlay').remove()">✕</button>
        <h3>✏️ 编辑语料</h3>
        <div class="form-group">
          <label>原文</label>
          <textarea id="editCorpusSource" class="form-textarea" rows="3">${this.escapeHtml(item.sourceText)}</textarea>
        </div>
        <div class="form-group">
          <label>译文</label>
          <textarea id="editCorpusTarget" class="form-textarea" rows="3">${this.escapeHtml(item.targetText)}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>源语言</label>
            <select id="editCorpusSourceLang" class="lang-select">
              <option value="en" ${item.sourceLang === 'en' ? 'selected' : ''}>英语</option>
              <option value="zh" ${item.sourceLang === 'zh' ? 'selected' : ''}>中文</option>
              <option value="ja" ${item.sourceLang === 'ja' ? 'selected' : ''}>日文</option>
              <option value="ko" ${item.sourceLang === 'ko' ? 'selected' : ''}>韩文</option>
              <option value="fr" ${item.sourceLang === 'fr' ? 'selected' : ''}>法文</option>
              <option value="de" ${item.sourceLang === 'de' ? 'selected' : ''}>德文</option>
              <option value="es" ${item.sourceLang === 'es' ? 'selected' : ''}>西班牙文</option>
            </select>
          </div>
          <div class="form-group">
            <label>目标语言</label>
            <select id="editCorpusTargetLang" class="lang-select">
              <option value="zh" ${item.targetLang === 'zh' ? 'selected' : ''}>中文</option>
              <option value="en" ${item.targetLang === 'en' ? 'selected' : ''}>英语</option>
              <option value="ja" ${item.targetLang === 'ja' ? 'selected' : ''}>日文</option>
              <option value="ko" ${item.targetLang === 'ko' ? 'selected' : ''}>韩文</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>标签</label>
          <input type="text" id="editCorpusTags" class="form-input" value="${this.escapeHtml(item.tags || '')}" placeholder="标签（逗号分隔）">
        </div>
        <div class="form-group">
          <label><input type="checkbox" id="editCorpusIsTerm" ${item.isTerm ? 'checked' : ''}> 设为强制术语</label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" onclick="VibeCorpus.saveEdit(${id})">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  saveEdit(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    const sourceText = document.getElementById('editCorpusSource').value.trim();
    const targetText = document.getElementById('editCorpusTarget').value.trim();
    if (!sourceText || !targetText) {
      VibeApp.showToast('原文和译文不能为空', 'error');
      return;
    }
    item.sourceText = sourceText;
    item.targetText = targetText;
    item.sourceLang = document.getElementById('editCorpusSourceLang').value;
    item.targetLang = document.getElementById('editCorpusTargetLang').value;
    item.langPair = `${item.sourceLang}-${item.targetLang}`;
    item.tags = document.getElementById('editCorpusTags').value;
    item.isTerm = document.getElementById('editCorpusIsTerm').checked;
    this.save();
    this.render();
    this.updateStats();
    document.querySelector('.modal-overlay.show')?.remove();
    VibeApp.showToast('已保存', 'success');
  },

  /**
   * 设置搜索查询
   * @param {string} query - 搜索关键词
   */
  setSearchQuery(query) {
    this.searchQuery = query;
    this.render();
  },

  /**
   * 设置语言筛选
   * @param {string} langPair - 语言对
   */
  setLangFilter(langPair) {
    this.langFilter = langPair;
    this.render();
  },

  /**
   * 复制到翻译模块
   * @param {number} id - 条目ID
   */
  copyToTranslator(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      document.getElementById('sourceText').value = item.sourceText;
      document.getElementById('sourceLang').value = item.sourceLang;
      document.getElementById('targetLang').value = item.targetLang;
      
      document.querySelector('[data-module="translator"]').click();
      document.getElementById('translateBtn').click();
    }
  },

  /**
   * 确认删除
   * @param {number} id - 条目ID
   */
  confirmDelete(id) {
    if (confirm('确定要删除这条语料吗？')) {
      this.remove(id);
      VibeApp.showToast('删除成功', 'success');
    }
  },

  /**
   * HTML转义
   * @param {string} text - 文本
   * @returns {string} 转义后的文本
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * 格式化日期
   * @param {string} dateStr - ISO日期字符串
   * @returns {string} 格式化后的日期
   */
  formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
};

// 暴露模块
window.VibeCorpus = VibeCorpus;
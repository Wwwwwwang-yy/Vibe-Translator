/**
 * 快照模块
 * 实现自动快照、历史记录、回滚与命名标签功能
 */
const VibeSnapshot = {
  MAX_SNAPSHOTS: 50,
  snapshots: [],
  tags: [],
  currentPreviewIndex: -1,
  isPreviewMode: false,
  onSnapshotChange: null,

  init() {
    this.loadSnapshots();
    this.loadTags();
  },

  createSnapshot(actionType, description, previewText = '') {
    if (typeof VibeSubtitles === 'undefined') return null;

    const snapshot = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      actionType: actionType,
      description: description,
      previewText: previewText,
      data: {
        subtitles: JSON.parse(JSON.stringify(VibeSubtitles.subtitles || [])),
        globalStyle: JSON.parse(JSON.stringify(VibeSubtitles.globalStyleSettings || {})),
        isGlobalStyle: VibeSubtitles.isGlobalStyle,
        currentTrack: VibeSubtitles.currentTrack,
        styleTemplates: JSON.parse(JSON.stringify(VibeSubtitles.styleTemplates || []))
      }
    };

    this.snapshots.unshift(snapshot);

    if (this.snapshots.length > this.MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(0, this.MAX_SNAPSHOTS);
    }

    this.saveSnapshots();
    this._notify();

    return snapshot;
  },

  getSnapshots(filterType = 'all') {
    if (filterType === 'all') {
      return this.snapshots;
    }
    return this.snapshots.filter(s => s.actionType === filterType);
  },

  getSnapshotById(id) {
    return this.snapshots.find(s => s.id === id);
  },

  previewSnapshot(id) {
    const snapshot = this.getSnapshotById(id);
    if (!snapshot) return false;

    if (!this.isPreviewMode) {
      this._backupCurrentState();
    }

    this.isPreviewMode = true;
    this.currentPreviewIndex = this.snapshots.findIndex(s => s.id === id);

    this._applySnapshotData(snapshot.data, true);

    return true;
  },

  exitPreview() {
    if (!this.isPreviewMode) return;

    this._restoreBackup();
    this.isPreviewMode = false;
    this.currentPreviewIndex = -1;
  },

  restoreSnapshot(id) {
    const snapshot = this.getSnapshotById(id);
    if (!snapshot) return false;

    this._applySnapshotData(snapshot.data, false);

    this.createSnapshot('rollback', `恢复到：${snapshot.description}`);

    this.isPreviewMode = false;
    this.currentPreviewIndex = -1;
    this._clearBackup();

    return true;
  },

  createTag(snapshotId, tagName) {
    const snapshot = this.getSnapshotById(snapshotId);
    if (!snapshot) return false;

    const tag = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      name: tagName,
      snapshotId: snapshotId,
      createdAt: Date.now()
    };

    this.tags.push(tag);
    this.saveTags();
    this._notify();

    return tag;
  },

  deleteTag(tagId) {
    this.tags = this.tags.filter(t => t.id !== tagId);
    this.saveTags();
    this._notify();
  },

  getTags() {
    return this.tags;
  },

  getSnapshotsWithTags() {
    return this.snapshots.map(snapshot => ({
      ...snapshot,
      tags: this.tags.filter(t => t.snapshotId === snapshot.id)
    }));
  },

  clearAll() {
    this.snapshots = [];
    this.tags = [];
    this.saveSnapshots();
    this.saveTags();
    this._notify();
  },

  _backupCurrentState() {
    if (typeof VibeSubtitles === 'undefined') return;

    this._backup = {
      subtitles: JSON.parse(JSON.stringify(VibeSubtitles.subtitles || [])),
      globalStyle: JSON.parse(JSON.stringify(VibeSubtitles.globalStyleSettings || {})),
      isGlobalStyle: VibeSubtitles.isGlobalStyle,
      currentTrack: VibeSubtitles.currentTrack,
      styleTemplates: JSON.parse(JSON.stringify(VibeSubtitles.styleTemplates || []))
    };
  },

  _restoreBackup() {
    if (!this._backup || typeof VibeSubtitles === 'undefined') return;

    this._applySnapshotData(this._backup, false);
    this._clearBackup();
  },

  _clearBackup() {
    this._backup = null;
  },

  _applySnapshotData(data, isReadOnly) {
    if (typeof VibeSubtitles === 'undefined') return;

    VibeSubtitles.subtitles = JSON.parse(JSON.stringify(data.subtitles || []));
    VibeSubtitles.globalStyleSettings = JSON.parse(JSON.stringify(data.globalStyle || {}));
    VibeSubtitles.isGlobalStyle = data.isGlobalStyle !== undefined ? data.isGlobalStyle : true;
    VibeSubtitles.currentTrack = data.currentTrack || 'main';
    VibeSubtitles.styleTemplates = JSON.parse(JSON.stringify(data.styleTemplates || []));

    if (typeof VibeSubtitles.renderTimeline === 'function') {
      VibeSubtitles.renderTimeline();
    }
    if (typeof VibeSubtitles.updateUI === 'function') {
      VibeSubtitles.updateUI();
    }
    if (typeof VibeSubtitles.renderTrackTabs === 'function') {
      VibeSubtitles.renderTrackTabs();
    }
    if (typeof VibeSubtitles.applyGlobalStyle === 'function') {
      VibeSubtitles.applyGlobalStyle();
    }
  },

  saveSnapshots() {
    VibeStorage.set('vibetrans_snapshots', this.snapshots);
  },

  loadSnapshots() {
    this.snapshots = VibeStorage.get('vibetrans_snapshots', []) || [];
  },

  saveTags() {
    VibeStorage.set('vibetrans_snapshot_tags', this.tags);
  },

  loadTags() {
    this.tags = VibeStorage.get('vibetrans_snapshot_tags', []) || [];
  },

  _notify() {
    if (this.onSnapshotChange) {
      this.onSnapshotChange({
        count: this.snapshots.length,
        tags: this.tags.length
      });
    }
  },

  generateDescription(actionType, subtitleIndex, fieldName, oldValue, newValue) {
    const index = subtitleIndex !== undefined ? subtitleIndex + 1 : '';

    const descriptions = {
      'add': `添加了第 ${index} 条字幕`,
      'delete': `删除了第 ${index} 条字幕`,
      'update_original': `修改了第 ${index} 条字幕的原文`,
      'update_translated': `修改了第 ${index} 条字幕的译文`,
      'update_time': `调整了第 ${index} 条字幕的时间`,
      'update_position': `拖动了第 ${index} 条字幕的位置`,
      'update_style': `修改了字幕样式`,
      'apply_global_style': '应用了全局样式',
      'batch_translate': '批量翻译字幕',
      'merge': `合并了字幕`,
      'split': `拆分了第 ${index} 条字幕`,
      'import': '导入了字幕文件',
      'rollback': '恢复到历史版本'
    };

    return descriptions[actionType] || `${actionType} 操作`;
  },

  getPreviewText(subtitle, maxLength = 20) {
    if (!subtitle) return '';
    const text = subtitle.originalText || subtitle.original || subtitle.text || '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
};

window.VibeSnapshot = VibeSnapshot;

const VibeSnapshotUI = {
  isPanelOpen: true,
  currentFilter: 'all',
  selectedSnapshotId: null,

  init() {
    VibeSnapshot.init();
    this.renderHistoryList();
    this.updateCount();

    VibeSnapshot.onSnapshotChange = () => {
      this.renderHistoryList();
      this.updateCount();
    };
  },

  togglePanel() {
    this.isPanelOpen = !this.isPanelOpen;
    const body = document.getElementById('historyPanelBody');
    const icon = document.getElementById('historyToggleIcon');

    if (body) {
      body.style.display = this.isPanelOpen ? 'block' : 'none';
    }
    if (icon) {
      icon.style.transform = this.isPanelOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
    }
  },
  filterSnapshots(filterType) {
    this.currentFilter = filterType;
    this.renderHistoryList();
  },

  renderHistoryList() {
    const listEl = document.getElementById('historyList');
    if (!listEl) return;

    const snapshots = VibeSnapshot.getSnapshotsWithTags().filter(s => {
      if (this.currentFilter === 'all') return true;
      return s.actionType === this.currentFilter;
    });

    if (snapshots.length === 0) {
      listEl.innerHTML = `
        <div class="history-empty">
          <span class="history-empty-icon">📭</span>
          <span>暂无历史记录</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = snapshots.map(snapshot => `
      <div class="history-item ${this.selectedSnapshotId === snapshot.id ? 'selected' : ''}" 
           onclick="VibeSnapshotUI.previewSnapshot('${snapshot.id}')">
        <div class="history-item-header">
          <span class="history-action-type ${snapshot.actionType}">
            ${this.getActionIcon(snapshot.actionType)} ${this.getActionLabel(snapshot.actionType)}
          </span>
          <span class="history-time">${this.formatTime(snapshot.timestamp)}</span>
        </div>
        <div class="history-item-desc">${snapshot.description}</div>
        ${snapshot.previewText ? `<div class="history-item-preview">"${snapshot.previewText}"</div>` : ''}
        ${snapshot.tags && snapshot.tags.length > 0 ? `
          <div class="history-item-tags">
            ${snapshot.tags.map(tag => `
              <span class="history-tag">
                🏷️ ${tag.name}
                <button class="tag-delete-btn" onclick="event.stopPropagation(); VibeSnapshotUI.deleteTag('${tag.id}')">✕</button>
              </span>
            `).join('')}
          </div>
        ` : ''}
        <div class="history-item-actions" onclick="event.stopPropagation()">
          <button class="history-btn restore-btn" onclick="VibeSnapshotUI.restoreSnapshot('${snapshot.id}')">
            ↩️ 恢复
          </button>
          <button class="history-btn tag-btn" onclick="VibeSnapshotUI.showAddTagDialog('${snapshot.id}')">
            🏷️ 标签
          </button>
        </div>
      </div>
    `).join('');
  },

  updateCount() {
    const countEl = document.getElementById('historyCount');
    if (countEl) {
      countEl.textContent = VibeSnapshot.snapshots.length;
    }
  },

  previewSnapshot(id) {
    if (this.selectedSnapshotId === id && VibeSnapshot.isPreviewMode) {
      this.exitPreview();
      return;
    }

    this.selectedSnapshotId = id;
    VibeSnapshot.previewSnapshot(id);
    this.renderHistoryList();

    VibeApp.showToast('预览模式：点击其他条目切换，再次点击取消', 'info');
  },

  exitPreview() {
    VibeSnapshot.exitPreview();
    this.selectedSnapshotId = null;
    this.renderHistoryList();
  },

  restoreSnapshot(id) {
    if (!confirm('确定要恢复到此版本吗？当前内容将被替换。')) {
      return;
    }

    VibeSnapshot.restoreSnapshot(id);
    this.selectedSnapshotId = null;
    this.renderHistoryList();
    VibeApp.showToast('已恢复到历史版本', 'success');
  },

  showAddTagDialog(snapshotId) {
    const tagName = prompt('请输入标签名称（如：初稿完成）：');
    if (!tagName || !tagName.trim()) return;

    VibeSnapshot.createTag(snapshotId, tagName.trim());
    this.renderHistoryList();
    VibeApp.showToast('标签已添加', 'success');
  },

  deleteTag(tagId) {
    if (!confirm('确定要删除这个标签吗？')) return;

    VibeSnapshot.deleteTag(tagId);
    this.renderHistoryList();
  },

  getActionIcon(actionType) {
    const icons = {
      'add': '➕',
      'delete': '🗑️',
      'update_original': '✏️',
      'update_translated': '🌐',
      'update_time': '⏱️',
      'update_position': '↔️',
      'update_style': '🎨',
      'apply_global_style': '✨',
      'batch_translate': '🌐',
      'merge': '🔗',
      'split': '✂️',
      'import': '📥',
      'rollback': '↩️'
    };
    return icons[actionType] || '📝';
  },

  getActionLabel(actionType) {
    const labels = {
      'add': '添加',
      'delete': '删除',
      'update_original': '修改原文',
      'update_translated': '修改译文',
      'update_time': '调整时间',
      'update_position': '调整位置',
      'update_style': '修改样式',
      'apply_global_style': '应用全局样式',
      'batch_translate': '批量翻译',
      'merge': '合并',
      'split': '拆分',
      'import': '导入',
      'rollback': '回滚'
    };
    return labels[actionType] || actionType;
  },

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) {
      return '刚刚';
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)} 分钟前`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)} 小时前`;
    } else {
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${month}-${day} ${hours}:${minutes}`;
    }
  }
};

window.VibeSnapshotUI = VibeSnapshotUI;

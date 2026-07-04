const VibeUndo = {
  stack: [],
  redoStack: [],
  maxStackSize: 50,
  onStateChange: null,

  push(action) {
    if (this.stack.length >= this.maxStackSize) {
      this.stack.shift();
    }
    this.stack.push(action);
    this.redoStack = [];
    this._notify();
  },

  undo() {
    if (this.stack.length === 0) return false;
    
    const action = this.stack.pop();
    if (action.undo) {
      action.undo();
    }
    this.redoStack.push(action);
    this._notify();
    return true;
  },

  redo() {
    if (this.redoStack.length === 0) return false;
    
    const action = this.redoStack.pop();
    if (action.redo || action.execute) {
      action.redo ? action.redo() : action.execute();
    }
    this.stack.push(action);
    this._notify();
    return true;
  },

  canUndo() {
    return this.stack.length > 0;
  },

  canRedo() {
    return this.redoStack.length > 0;
  },

  clear() {
    this.stack = [];
    this.redoStack = [];
    this._notify();
  },

  _notify() {
    if (this.onStateChange) {
      this.onStateChange({
        canUndo: this.canUndo(),
        canRedo: this.canRedo()
      });
    }
  },

  createInsertAction(subtitles, index) {
    return {
      type: 'insert',
      subtitles,
      index,
      undo: () => {
        VibeSubtitles.removeSubtitles(subtitles.map(s => s.id));
      },
      redo: () => {
        VibeSubtitles.subtitles.splice(index, 0, ...subtitles);
        VibeSubtitles.sortSubtitles();
        VibeSubtitles.renderTimeline();
        VibeSubtitles.updateUI();
      }
    };
  },

  createDeleteAction(subtitles, indices) {
    return {
      type: 'delete',
      subtitles,
      indices,
      undo: () => {
        VibeSubtitles.subtitles.splice(indices[0], 0, ...subtitles);
        VibeSubtitles.sortSubtitles();
        VibeSubtitles.renderTimeline();
        VibeSubtitles.updateUI();
      },
      redo: () => {
        VibeSubtitles.removeSubtitles(subtitles.map(s => s.id));
      }
    };
  },

  createUpdateAction(subtitleId, oldData, newData) {
    return {
      type: 'update',
      subtitleId,
      oldData,
      newData,
      undo: () => {
        const idx = VibeSubtitles.subtitles.findIndex(s => s.id === subtitleId);
        if (idx !== -1) {
          Object.assign(VibeSubtitles.subtitles[idx], oldData);
          VibeSubtitles.renderTimeline();
          VibeSubtitles.updateUI();
        }
      },
      redo: () => {
        const idx = VibeSubtitles.subtitles.findIndex(s => s.id === subtitleId);
        if (idx !== -1) {
          Object.assign(VibeSubtitles.subtitles[idx], newData);
          VibeSubtitles.renderTimeline();
          VibeSubtitles.updateUI();
        }
      }
    };
  },

  createBatchTimeOffsetAction(subtitleIds, offsetMs) {
    const originals = [];
    subtitleIds.forEach(id => {
      const idx = VibeSubtitles.subtitles.findIndex(s => s.id === id);
      if (idx !== -1) {
        originals.push({
          id,
          originalStart: VibeSubtitles.subtitles[idx].start,
          originalEnd: VibeSubtitles.subtitles[idx].end
        });
      }
    });

    return {
      type: 'batch_time_offset',
      originals,
      offsetMs,
      undo: () => {
        originals.forEach(item => {
          const idx = VibeSubtitles.subtitles.findIndex(s => s.id === item.id);
          if (idx !== -1) {
            VibeSubtitles.subtitles[idx].start = item.originalStart;
            VibeSubtitles.subtitles[idx].end = item.originalEnd;
          }
        });
        VibeSubtitles.sortSubtitles();
        VibeSubtitles.renderTimeline();
        VibeSubtitles.updateUI();
      },
      redo: () => {
        originals.forEach(item => {
          const idx = VibeSubtitles.subtitles.findIndex(s => s.id === item.id);
          if (idx !== -1) {
            VibeSubtitles.subtitles[idx].start = item.originalStart + offsetMs / 1000;
            VibeSubtitles.subtitles[idx].end = item.originalEnd + offsetMs / 1000;
          }
        });
        VibeSubtitles.sortSubtitles();
        VibeSubtitles.renderTimeline();
        VibeSubtitles.updateUI();
      }
    };
  },

  createMergeAction(subtitles, mergedSubtitle) {
    return {
      type: 'merge',
      subtitles,
      mergedSubtitle,
      undo: () => {
        const idx = VibeSubtitles.subtitles.findIndex(s => s.id === mergedSubtitle.id);
        if (idx !== -1) {
          VibeSubtitles.subtitles.splice(idx, 1, ...subtitles);
        }
        VibeSubtitles.sortSubtitles();
        VibeSubtitles.renderTimeline();
        VibeSubtitles.updateUI();
      },
      redo: () => {
        const ids = subtitles.map(s => s.id);
        VibeSubtitles.subtitles = VibeSubtitles.subtitles.filter(s => !ids.includes(s.id));
        VibeSubtitles.subtitles.push(mergedSubtitle);
        VibeSubtitles.sortSubtitles();
        VibeSubtitles.renderTimeline();
        VibeSubtitles.updateUI();
      }
    };
  }
};

window.VibeUndo = VibeUndo;
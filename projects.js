const VibeProjects = {
  projects: [],
  currentProject: null,
  
  init() {
    this.loadProjects();
    this.bindEvents();
    this.autoSaveInterval = setInterval(() => this.autoSave(), 30000);
  },
  
  bindEvents() {
    const projectBtn = document.getElementById('projectBtn');
    if (projectBtn) {
      projectBtn.addEventListener('click', () => {
        this.toggleProjectMenu();
      });
    }
    
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#projectBtn') && !e.target.closest('.project-menu')) {
        this.hideProjectMenu();
      }
    });
  },
  
  loadProjects() {
    try {
      const saved = VibeStorage.get(VibeStorage.KEYS.PROJECTS, []);
      this.projects = Array.isArray(saved) ? saved : [];
    } catch (error) {
      console.error('[Projects] 加载项目失败:', error);
      this.projects = [];
    }
  },
  
  saveProjects() {
    try {
      VibeStorage.set(VibeStorage.KEYS.PROJECTS, this.projects);
    } catch (error) {
      console.error('[Projects] 保存项目失败:', error);
    }
  },
  
  autoSave() {
    if (!VibeSubtitles || VibeSubtitles.subtitles.length === 0) return;
    
    const videoFile = VibeSubtitles.videoFile;
    const videoUrl = VibeSubtitles.videoUrl;
    const projectName = videoFile ? videoFile.name : '未命名项目';
    
    let project = this.projects.find(p => p.name === projectName);
    
    if (!project) {
      project = {
        id: Date.now(),
        name: projectName,
        createdAt: Date.now(),
        lastEditedAt: Date.now(),
        subtitleCount: 0
      };
      this.projects.unshift(project);
    }
    
    project.lastEditedAt = Date.now();
    project.subtitleCount = VibeSubtitles.subtitles.length;
    project.subtitles = JSON.parse(JSON.stringify(VibeSubtitles.subtitles));
    project.styleSettings = JSON.parse(JSON.stringify(VibeSubtitles.globalStyleSettings));
    project.recognizeLanguage = VibeSubtitles.recognizeLanguage;
    
    if (this.projects.length > 20) {
      this.projects = this.projects.slice(0, 20);
    }
    
    this.saveProjects();
  },
  
  createNewProject() {
    if (VibeSubtitles) {
      VibeSubtitles.subtitles = [];
      VibeSubtitles.videoUrl = null;
      VibeSubtitles.videoFile = null;
      VibeSubtitles.renderTimeline();
      VibeSubtitles.updateUI();
    }
    
    this.currentProject = null;
    VibeApp.showToast('已创建新项目', 'success');
    this.hideProjectMenu();
  },
  
  openProject(projectId) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) return;
    
    this.currentProject = project;
    
    if (VibeSubtitles) {
      VibeSubtitles.subtitles = project.subtitles || [];
      VibeSubtitles.globalStyleSettings = project.styleSettings || VibeSubtitles.globalStyleSettings;
      VibeSubtitles.recognizeLanguage = project.recognizeLanguage || 'zh';
      VibeSubtitles.renderTimeline();
      VibeSubtitles.updateUI();
    }
    
    project.lastEditedAt = Date.now();
    this.saveProjects();
    
    VibeApp.showToast(`已打开项目: ${project.name}`, 'success');
    this.hideProjectMenu();
    
    document.querySelector('[data-module="subtitles"]').click();
  },
  
  deleteProject(projectId) {
    if (!confirm('确定要删除这个项目吗？此操作不可撤销。')) return;
    
    this.projects = this.projects.filter(p => p.id !== projectId);
    this.saveProjects();
    
    if (this.currentProject && this.currentProject.id === projectId) {
      this.currentProject = null;
    }
    
    this.renderProjectMenu();
    VibeApp.showToast('项目已删除', 'success');
  },
  
  exportProject(projectId) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) return;
    
    const exportData = {
      version: '1.0',
      exportedAt: Date.now(),
      project: project
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.vtproject`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    VibeApp.showToast('项目已导出', 'success');
    this.hideProjectMenu();
  },
  
  importProject() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vtproject,.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          const project = data.project || data;
          
          project.id = Date.now();
          project.createdAt = Date.now();
          project.lastEditedAt = Date.now();
          
          this.projects.unshift(project);
          this.saveProjects();
          
          this.openProject(project.id);
          VibeApp.showToast('项目导入成功', 'success');
        } catch (error) {
          VibeApp.showToast('项目导入失败: ' + error.message, 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },
  
  toggleProjectMenu() {
    const menu = document.getElementById('projectMenu');
    if (menu) {
      menu.remove();
      return;
    }
    
    this.renderProjectMenu();
  },
  
  hideProjectMenu() {
    const menu = document.getElementById('projectMenu');
    if (menu) {
      menu.remove();
    }
  },
  
  renderProjectMenu() {
    const btn = document.getElementById('projectBtn');
    const rect = btn.getBoundingClientRect();
    
    const menu = document.createElement('div');
    menu.id = 'projectMenu';
    menu.className = 'project-menu';
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 8 + 'px';
    
    let html = `
      <div class="project-menu-header">
        <span>📁 项目管理</span>
      </div>
      <div class="project-menu-actions">
        <button class="project-action-btn" onclick="VibeProjects.createNewProject()">
          <span>➕</span> 新建项目
        </button>
        <button class="project-action-btn" onclick="VibeProjects.importProject()">
          <span>📥</span> 导入项目
        </button>
      </div>
      <div class="project-menu-divider"></div>
    `;
    
    if (this.projects.length === 0) {
      html += `
        <div class="project-empty">
          <span>暂无项目</span>
          <p>导入视频后自动保存项目</p>
        </div>
      `;
    } else {
      html += `
        <div class="project-list">
          ${this.projects.slice(0, 10).map(project => `
            <div class="project-item">
              <div class="project-info">
                <div class="project-name">${this.escapeHtml(project.name)}</div>
                <div class="project-meta">
                  <span>${project.subtitleCount} 条字幕</span>
                  <span>${this.formatTime(project.lastEditedAt)}</span>
                </div>
              </div>
              <div class="project-actions">
                <button class="project-btn" onclick="VibeProjects.openProject(${project.id})" title="打开">📂</button>
                <button class="project-btn" onclick="VibeProjects.exportProject(${project.id})" title="导出">📤</button>
                <button class="project-btn project-btn-danger" onclick="VibeProjects.deleteProject(${project.id})" title="删除">🗑️</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
    
    menu.innerHTML = html;
    document.body.appendChild(menu);
  },
  
  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    
    return `${date.getMonth() + 1}/${date.getDate()}`;
  },
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  
  destroy() {
    clearInterval(this.autoSaveInterval);
    this.hideProjectMenu();
  }
};

window.VibeProjects = VibeProjects;
// Initialize Supabase Connection
const SUPABASE_URL = 'https://oipqynnhgpwqgywpkwxk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pcHF5bm5oZ3B3cWd5d3Brd3hrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NTU3NDUsImV4cCI6MjA5NDEzMTc0NX0.kfwNygfTLFEcnZqJS-z-SB-9Kuazqk80s9bAJ_z6_M8';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Local Cache / State
let projects = [];
let tasks = [];
let currentView = 'vertical'; // 'vertical' or 'table'
const COLUMNS = ['Onboarding', 'Design', 'Frontend', 'Backend', 'Beta', 'Live'];

// DOM Elements Handlers
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const projectList = document.getElementById('project-list');
const projectCountBadge = document.getElementById('project-count');
const btnCreateProject = document.getElementById('btn-create-project');
const timeline = document.getElementById('timeline');

// Modal Accessors
const projectModal = document.getElementById('project-modal');
const taskModal = document.getElementById('task-modal');
const projectForm = document.getElementById('project-form');
const taskForm = document.getElementById('task-form');
const typeBtns = document.querySelectorAll('.type-btn');

// Global Loader
async function bootstrap() {
    console.log('Initiating live fetch from Supabase...');
    await syncData();
    renderSidebar();
    renderActiveView();
    setupEventListeners();
    
    // Auto sync from sheet on bootstrap if available
    setTimeout(() => syncGoogleSheets(true), 1000);
}

document.addEventListener('DOMContentLoaded', bootstrap);

// Core Sync Unit
async function syncData() {
    const { data: pData, error: pErr } = await supabaseClient.from('projects').select('*');
    const { data: tData, error: tErr } = await supabaseClient.from('tasks').select('*');
    
    if (pErr) console.error('Projects fail:', pErr);
    if (tErr) console.error('Tasks fail:', tErr);
    
    // Normalize names mapping SQL -> frontend schema
    projects = (pData || []).map(p => ({
        ...p,
        column: p.phase_column
    }));
    
    tasks = (tData || []).map(t => ({
        ...t,
        projectId: t.project_id
    }));
}

function setupEventListeners() {
    // Sidebar Toggle
    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const icon = toggleSidebarBtn.querySelector('.material-symbols-outlined');
        icon.textContent = sidebar.classList.contains('collapsed') ? 'menu' : 'menu_open';
    });

    // Create Project Modal
    btnCreateProject.addEventListener('click', () => {
        openProjectModal();
    });

    // Modal Close
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeModals);
    });

    // Backdrop Close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModals();
        });
    });

    // Project Type Selection
    typeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            typeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Project Form Submit
    projectForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-project-id').value;
        const name = document.getElementById('project-name').value;
        const type = document.querySelector('.type-btn.active').dataset.type;
        const status = document.getElementById('project-status').value;
        const priority = document.getElementById('project-priority').value;

        if (id) {
            await updateProject(id, { name, type, status, priority });
        } else {
            await addProject(name, type, status, priority);
        }
        closeModals();
    });

    // Task Form Submit
    taskForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const projectId = document.getElementById('task-project-id').value;
        const phase = document.getElementById('task-phase').value;
        const title = document.getElementById('task-title').value;
        const labelsRaw = document.getElementById('task-labels').value;
        const labels = labelsRaw.split(',').map(l => l.trim()).filter(l => l !== '');

        await addTask(projectId, phase, title, labels);
        closeModals();
    });

    // Project Search
    const searchInput = document.getElementById('project-search');
    searchInput.addEventListener('input', (e) => {
        renderSidebar(e.target.value, document.getElementById('project-sort').value);
    });

    // Project Sort
    const sortSelect = document.getElementById('project-sort');
    sortSelect.addEventListener('change', (e) => {
        renderSidebar(searchInput.value, e.target.value);
    });

    // View Toggles
    const btnVertical = document.getElementById('btn-view-vertical');
    const btnTable = document.getElementById('btn-view-table');
    const btnSync = document.getElementById('btn-sync-sheet');

    if(btnVertical && btnTable) {
        btnVertical.addEventListener('click', () => {
            currentView = 'vertical';
            btnVertical.classList.add('active');
            btnTable.classList.remove('active');
            renderActiveView();
        });
        btnTable.addEventListener('click', () => {
            currentView = 'table';
            btnTable.classList.add('active');
            btnVertical.classList.remove('active');
            renderActiveView();
        });
    }

    if(btnSync) {
        btnSync.addEventListener('click', () => syncGoogleSheets());
    }
}

// Project Operations
// Project Operations
async function addProject(name, type, status = 'In Progress', priority = 'Medium') {
    const allPool = ['JD','SK','MP','AL','BV'];
    const count = Math.floor(Math.random() * 2) + 1;
    const members = allPool.sort(() => 0.5 - Math.random()).slice(0, count);

    const { error } = await supabaseClient.from('projects').insert([{
        name, type, status, priority, members,
        phase_column: 'Onboarding'
    }]);
    
    if (error) {
        showToast('Push Failed', 'Unable to initialize project in cloud.', true);
    } else {
        showToast('Launch Status', 'Project successfully drafted to board.');
    }
    await reHydrateAndRender();
}

async function updateProject(id, updates) {
    const { error } = await supabaseClient.from('projects')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) showToast('Error', 'Failed to store project edits.', true);
    else showToast('Updated', 'Project metrics refined.');
    await reHydrateAndRender();
}

async function deleteProject(id) {
    const { error } = await supabaseClient.from('projects').delete().eq('id', id);
    if (error) showToast('Action Halted', 'Could not remove project.', true);
    else showToast('Archived', 'Project record deleted safely.');
    await reHydrateAndRender();
}

async function moveProject(id, column) {
    const proj = projects.find(p => p.id === id);
    if (!proj || proj.column === column) return;

    if (confirm(`Move "${proj.name}" to phase: ${column}?`)) {
        const { error } = await supabaseClient.from('projects')
            .update({ phase_column: column, updated_at: new Date().toISOString() })
            .eq('id', id);
        
        if (error) showToast('Transfer Blocked', 'Phase shift failed at source.', true);
        else showToast('Phase Advance', `Advancing status to ${column}`);
        await reHydrateAndRender();
    }
}

// Task Operations
async function addTask(projectId, phase, title, labels) {
    const { error } = await supabaseClient.from('tasks').insert([{
        project_id: projectId,
        phase,
        title,
        labels,
        status: 'Open'
    }]);
    if (error) showToast('Task Fail', 'Could not inject action item.', true);
    else showToast('Created', 'New action item cataloged.');
    await reHydrateAndRender();
}

async function updateTaskStatus(id) {
    const task = tasks.find(t => t.id === id);
    if(!task) return;
    const order = ['Open', 'Ongoing', 'Closed'];
    const nextIdx = (order.indexOf(task.status) + 1) % order.length;
    
    const { error } = await supabaseClient.from('tasks')
        .update({ status: order[nextIdx] })
        .eq('id', id);
    
    await reHydrateAndRender();
}

async function deleteTask(id) {
    const { error } = await supabaseClient.from('tasks').delete().eq('id', id);
    await reHydrateAndRender();
}

// Rendering
function renderSidebar(searchQuery = '', sortBy = 'newest') {
    projectList.innerHTML = '';
    projectCountBadge.textContent = projects.length;

    let processed = projects.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.type && p.type.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    processed.sort((a, b) => {
        if (sortBy === 'alpha') return a.name.localeCompare(b.name);
        const valA = new Date(a.updatedAt || a.createdAt).getTime();
        const valB = new Date(b.updatedAt || b.createdAt).getTime();
        return sortBy === 'oldest' ? valA - valB : valB - valA;
    });

    if (processed.length === 0) {
        projectList.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; opacity: 0.6;">
                <span class="material-symbols-outlined" style="font-size: 36px; margin-bottom: 10px; color: var(--brand-text-muted);">folder_off</span>
                <p style="font-size: 12px; font-weight: 800; color: var(--brand-text);">No matches found</p>
            </div>
        `;
        return;
    }

    const highlight = (str) => {
        if (!searchQuery.trim()) return str;
        const reg = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return str.replace(reg, '<mark class="highlight">$1</mark>');
    };

    processed.forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.draggable = true;
        
        const stat = project.status || 'In Progress';
        const statClass = stat.toLowerCase().replace(/\s+/g, '-');
        const memHTML = (project.members || ['U']).map((m, i) => `<div class="avatar" style="background: hsla(${i * 125}, 65%, 45%, 1); z-index:${10-i}">${m}</div>`).join('');

        card.innerHTML = `
            <div class="project-card-row">
                <span class="project-name" title="${project.name}">${highlight(project.name)}</span>
                <div class="project-card-actions">
                    <button class="mini-btn edit-q" aria-label="Edit Project"><span class="material-symbols-outlined" style="font-size:16px">edit</span></button>
                    <button class="mini-btn del-q" aria-label="Delete Project"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
                </div>
            </div>
            <div class="project-card-row" style="justify-content: flex-start; gap:6px; margin-top:-4px;">
                <span class="project-meta">${highlight(project.type)}</span>
                <span class="status-chip ${statClass}">${stat}</span>
            </div>
            <div class="project-card-footer">
                <div class="avatar-stack">${memHTML}</div>
                <span class="last-updated">${getTimeSpan(project.updatedAt || project.createdAt)}</span>
            </div>
        `;

        card.addEventListener('click', () => openProjectModal(project.id));
        card.querySelector('.edit-q').addEventListener('click', (e) => { e.stopPropagation(); openProjectModal(project.id); });
        card.querySelector('.del-q').addEventListener('click', (e) => { e.stopPropagation(); if(confirm(`Delete project: ${project.name}?`)) deleteProject(project.id); });
        
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', project.id);
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));

        projectList.appendChild(card);
    });
}

function getTimeSpan(iso) {
    if (!iso) return 'Pending';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return 'Fresh';
    const diff = Math.floor((new Date() - date) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
}

function renderActiveView() {
    if (currentView === 'table') {
        renderTableView();
    } else {
        renderTimeline();
    }
}

function renderTimeline() {
    timeline.innerHTML = '';
    timeline.className = 'timeline-container vertical-stack'; // Force vertical class
    
    const flowWrapper = document.createElement('div');
    flowWrapper.className = 'timeline-flow-vertical';
    
    COLUMNS.forEach((col, index) => {
        const colProjects = projects.filter(p => p.column === col);
        const colTasks = tasks.filter(t => t.phase === col);
        
        const closedTasks = colTasks.filter(t => t.status === 'Closed').length;
        const progress = colTasks.length > 0 ? Math.round((closedTasks / colTasks.length) * 100) : 0;

        const milestone = document.createElement('div');
        milestone.className = 'milestone-item vertical';
        
        milestone.innerHTML = `
            <div class="phase-card theme-${index + 1} collapsed" data-phase="${col}" onclick="toggleCard(this)">
                <div class="uiv-header vertical-layout">
                    <div class="uiv-image">
                         <span>${index + 1}</span>
                    </div>
                    <div class="uiv-content">
                         <span class="uiv-title">${col}</span>
                         <div class="project-stat-container">
                             <span class="project-stat">${colProjects.length} Projs | ${colTasks.length} Tasks</span>
                             <div class="project-tooltip">
                                 <p class="tooltip-title">Matrix Health</p>
                                 <div style="margin-bottom:6px;font-weight:800;color:#10b981;">V-Scale: ${progress}%</div>
                                 ${colProjects.length > 0 ? colProjects.map(p => `<div style="font-size:9px;opacity:0.9;">• ${p.name}</div>`).join('') : '<div style="font-size:9px;opacity:0.5;">- Ready -</div>'}
                             </div>
                         </div>
                         <div style="width: 100px; height: 3px; background: #f3f4f6; border-radius: 10px; margin: 10px auto 0; overflow: hidden;">
                             <div class="theme-pb" style="width: ${progress}%; height: 100%; background: currentColor; opacity:0.8; transition: width 0.5s ease;"></div>
                         </div>
                    </div>
                </div>

                <div class="uiv-actions">
                    <button type="button" class="uiv-btn-primary">Details & Tasks</button>
                    <button type="button" class="uiv-btn-secondary" onclick="event.stopPropagation(); openTaskModal('${col}')">+ New Task</button>
                </div>

                <div class="phase-card-extended">
                    <div class="task-list custom-scrollbar">
                        ${colTasks.length > 0 ? colTasks.map((task, i) => {
                            const project = projects.find(p => p.id === task.projectId);
                            const stClass = `st-${task.status.toLowerCase()}`;
                            const labelHTML = (task.labels || []).map(lbl => `<span class="task-label-pill">${lbl}</span>`).join('');
                            
                            return `
                                <div class="task-item">
                                    <div class="task-title-row">
                                        <div class="task-content">
                                            <span style="color: #94A3B8; font-weight: 600;">#${i+1}</span> ${task.title}
                                            <div class="task-subtitle">${project ? project.name : 'Standalone'}</div>
                                        </div>
                                        <button class="mini-btn" onclick="event.stopPropagation(); if(confirm('Delete task?')) deleteTask('${task.id}')">
                                            <span class="material-symbols-outlined" style="font-size: 14px;">delete</span>
                                        </button>
                                    </div>
                                    ${labelHTML ? `<div class="task-badge-row">${labelHTML}</div>` : ''}
                                    <div class="task-action-footer">
                                        <button class="status-toggle-btn ${stClass}" onclick="event.stopPropagation(); updateTaskStatus('${task.id}')">
                                            ${task.status}
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('') : `<div class="empty-msg">No tasks yet</div>`}
                    </div>
                </div>
            </div>
        `;

        const card = milestone.querySelector('.phase-card');
        card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-active'); });
        card.addEventListener('dragleave', () => card.classList.remove('drag-active'));
        card.addEventListener('drop', (e) => {
            e.preventDefault(); card.classList.remove('drag-active');
            const projId = e.dataTransfer.getData('text/plain');
            moveProject(projId, col);
        });

        flowWrapper.appendChild(milestone);
    });
    timeline.appendChild(flowWrapper);
}

function renderTableView() {
    timeline.innerHTML = '';
    timeline.className = 'timeline-container table-view-container';
    
    let html = `
        <div class="milestone-table-wrapper animate-slide-up">
            <table class="milestone-table">
                <thead>
                    <tr>
                        <th width="180">Milestone</th>
                        <th width="100">Progress</th>
                        <th>Assigned Projects</th>
                        <th>Key Tasks</th>
                        <th width="80">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    COLUMNS.forEach((col, idx) => {
        const colProjects = projects.filter(p => p.column === col);
        const colTasks = tasks.filter(t => t.phase === col);
        const closed = colTasks.filter(t => t.status === 'Closed').length;
        const progress = colTasks.length > 0 ? Math.round((closed / colTasks.length) * 100) : 0;
        
        const projectsHTML = colProjects.map(p => `
            <span class="table-proj-chip" onclick="openProjectModal('${p.id}')">
                ${p.name}
            </span>
        `).join('') || '<span class="txt-muted">-</span>';

        const tasksHTML = colTasks.map(t => {
            const stCls = `st-${t.status.toLowerCase()}`;
            return `
                <div class="table-task-row">
                    <span class="task-status-indicator ${stCls}" onclick="updateTaskStatus('${t.id}')" title="Click to toggle status">${t.status}</span>
                    <span class="task-name-txt">${t.title}</span>
                </div>
            `;
        }).join('') || '<span class="txt-muted">No tasks assigned</span>';

        html += `
            <tr class="milestone-tr" data-phase="${col}">
                <td>
                    <div class="td-phase-header theme-${idx+1}">
                        <span class="phase-num">${idx+1}</span>
                        <span class="phase-name">${col}</span>
                    </div>
                </td>
                <td>
                    <div class="table-progress-wrapper" title="${progress}% Completed">
                        <div class="table-progress-bar" style="width:${progress}%"></div>
                    </div>
                </td>
                <td>
                    <div class="table-projects-cell">${projectsHTML}</div>
                </td>
                <td>
                    <div class="table-tasks-cell">${tasksHTML}</div>
                </td>
                <td>
                    <button class="table-add-btn" onclick="openTaskModal('${col}')" title="Add Task">
                        <span class="material-symbols-outlined">add_circle</span>
                    </button>
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;
    timeline.innerHTML = html;

    // Add drop listeners to table rows for moving projects via drag&drop even in table view
    document.querySelectorAll('.milestone-tr').forEach(row => {
        row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('row-drag-over'); });
        row.addEventListener('dragleave', () => row.classList.remove('row-drag-over'));
        row.addEventListener('drop', (e) => {
            e.preventDefault(); row.classList.remove('row-drag-over');
            const id = e.dataTransfer.getData('text/plain');
            moveProject(id, row.dataset.phase);
        });
    });
}

function toggleCard(card) {
    card.classList.toggle('collapsed');
}

// Rehydration Subsystem
async function reHydrateAndRender() {
    await syncData();
    const sq = document.getElementById('project-search')?.value || '';
    const st = document.getElementById('project-sort')?.value || 'newest';
    renderSidebar(sq, st);
    renderActiveView();
}

function getIconForType(type) {
    switch(type) {
        case 'Mobile': return 'smartphone';
        case 'Design': return 'palette';
        default: return 'language';
    }
}

function openProjectModal(id = null) {
    const title = projectModal.querySelector('.modal-title');
    const submitText = document.getElementById('project-submit-text');
    const formId = document.getElementById('edit-project-id');
    const formName = document.getElementById('project-name');
    
    if (id) {
        const project = projects.find(p => p.id === id);
        title.innerHTML = `Edit <span class="accent">Project</span>`;
        submitText.textContent = 'Update Project';
        formId.value = id;
        formName.value = project.name;
        document.getElementById('project-status').value = project.status || 'In Progress';
        document.getElementById('project-priority').value = project.priority || 'Medium';
        typeBtns.forEach(b => {
            b.classList.toggle('active', b.dataset.type === project.type);
        });
    } else {
        title.innerHTML = `New <span class="accent">Project</span>`;
        submitText.textContent = 'Initialize Project';
        formId.value = '';
        formName.value = '';
        document.getElementById('project-status').value = 'In Progress';
        document.getElementById('project-priority').value = 'Medium';
        typeBtns.forEach(b => b.classList.toggle('active', b.dataset.type === 'Web'));
    }
    
    projectModal.classList.remove('hidden');
    formName.focus();
}

function openTaskModal(phase = 'Onboarding') {
    if (projects.length === 0) {
        showToast('Invalid Action', 'Create at least one project first.', true);
        return;
    }
    
    const projectSelect = document.getElementById('task-project-id');
    projectSelect.innerHTML = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    
    document.getElementById('task-phase').value = phase;
    document.getElementById('task-title').value = '';
    document.getElementById('task-labels').value = '';
    
    taskModal.classList.remove('hidden');
}

function closeModals() {
    projectModal.classList.add('hidden');
    taskModal.classList.add('hidden');
}

function toggleTasks(btn) {
    const list = btn.closest('.phase-card').querySelector('.task-list');
    const icon = btn.querySelector('.material-symbols-outlined');
    list.classList.toggle('hidden');
    btn.classList.toggle('active');
    icon.textContent = list.classList.contains('hidden') ? 'expand_more' : 'expand_less';
}

// Toast Notification Hub
function showToast(title, message, isError = false) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const entry = document.createElement('div');
    entry.className = 'toast-entry';
    entry.style.transition = 'all 0.3s ease';
    
    const icon = isError 
        ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>`;

    entry.innerHTML = `
        <div class="succsess-alert">
            <div class="alert-icon-wrap ${isError ? 'error' : ''}">${icon}</div>
            <div class="alert-body">
                <div class="alert-title">${title}</div>
                <div class="alert-subtitle">${message}</div>
            </div>
            <button class="alert-close-btn" onclick="this.closest('.toast-entry').remove()">
                <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
            </button>
        </div>
    `;
    
    container.appendChild(entry);

    // Auto dispose
    setTimeout(() => {
        if (entry.parentNode) {
            entry.style.opacity = '0';
            entry.style.transform = 'translateX(20px)';
            setTimeout(() => entry.remove(), 300);
        }
    }, 4000);
}

// Google Sheets Engine - REENGINEERED TO JSONP TO BYPASS CORS COMPLETELY
window.handleGvizSync = async function(response) {
    const syncIcon = document.getElementById('sync-icon');
    try {
        if (!response || !response.table || !response.table.rows) {
            throw new Error("Invalid Gviz payload");
        }
        
        const rows = response.table.rows;
        
        // Filter and extract names safely, guarding against null cells or headers
        const sheetNames = rows
            .map(row => {
                if (!row.c || !row.c[0]) return null;
                const val = row.c[0].v;
                return val ? String(val).trim() : null;
            })
            .filter(n => n && n.toLowerCase() !== 'project name');

        const existingNames = new Set(projects.map(p => p.name.trim().toLowerCase()));
        const newNames = [...new Set(sheetNames.filter(n => !existingNames.has(n.toLowerCase())))];

        if (newNames.length === 0) {
            showToast('Google Sheet Sync', 'No new projects discovered.', false);
            return;
        }

        let insertCount = 0;
        for (const pName of newNames) {
            const { error } = await supabaseClient.from('projects').insert([{
                name: pName,
                type: 'Web',
                status: 'In Progress',
                priority: 'Medium',
                members: ['GS'],
                phase_column: 'Onboarding'
            }]);
            if (!error) insertCount++;
        }

        if (insertCount > 0) {
            showToast('Sync Success', `Imported ${insertCount} new projects successfully.`);
            await reHydrateAndRender();
        }
    } catch (err) {
        console.error("Gviz Parse Fail:", err);
        showToast('Sync Process Fail', 'Could not decode worksheet logic.', true);
    } finally {
        if (syncIcon) syncIcon.classList.remove('spinning');
        // Clean up dynamic script if found
        const old = document.getElementById('gviz-sync-script');
        if(old) old.remove();
    }
};

async function syncGoogleSheets(silent = false) {
    const syncIcon = document.getElementById('sync-icon');
    if (syncIcon) syncIcon.classList.add('spinning');
    
    // Purge old script if it exists to allow re-runs
    const existing = document.getElementById('gviz-sync-script');
    if (existing) existing.remove();

    const sheetId = '1LRXpvSKhJMJhmCG70I-_v2qXihgNcJfYd9j7byRnW10';
    // Use direct dynamic script injection (JSONP) which is 100% immune to CORS
    const script = document.createElement('script');
    script.id = 'gviz-sync-script';
    script.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=responseHandler:handleGvizSync&gid=190319038&t=${Date.now()}`;
    
    script.onerror = () => {
        if (syncIcon) syncIcon.classList.remove('spinning');
        if (!silent) showToast('Fetch Blocked', 'Network refused gviz endpoint.', true);
        script.remove();
    };

    document.head.appendChild(script);
}

// Initialize Supabase Connection
const SUPABASE_URL = 'https://oipqynnhgpwqgywpkwxk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pcHF5bm5oZ3B3cWd5d3Brd3hrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NTU3NDUsImV4cCI6MjA5NDEzMTc0NX0.kfwNygfTLFEcnZqJS-z-SB-9Kuazqk80s9bAJ_z6_M8';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Local Cache / State
let projects = [];
let tasks = [];
let preTasks = []; // Fetched from task_repository
let currentView = 'table';
let recordsSearchQuery = '';
let recordsPage = 1;
const RECORDS_PER_PAGE = 8;
const COLUMNS = ['Onboarding', 'Design', 'Frontend', 'Backend', 'Beta', 'Live'];
const FALLBACK_COMMON_TASKS = [
    "Requirement Gathering", "Initial Briefing", "Wireframe Approval", "UI Design Phase",
    "API Integration", "Database Schema Setup", "Frontend Components", "QA Testing",
    "Client Feedback Round", "Production Deployment", "User Training"
];
let activeSidebarTab = 'projects';
let qvPhase = null;
let qvType = null;

function getProjectHue(str) {
    let hash = 0;
    const cleanStr = str ? String(str) : "default";
    for (let i = 0; i < cleanStr.length; i++) {
        hash = cleanStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
}

async function reHydrateAndRender() {
    await syncData();
    const sq = document.getElementById('project-search')?.value || '';
    const st = document.getElementById('project-sort')?.value || 'newest';
    renderSidebar(sq, st);
    renderActiveView();

    // Auto-Refresh Quick View Modal if open
    if (qvPhase && qvType && !quickViewModal.classList.contains('hidden')) {
        refreshQuickView();
    }
}

// DOM Elements Handlers
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const projectList = document.getElementById('project-list');
const taskRepoList = document.getElementById('task-repo-list');
const vaultCountBadge = document.getElementById('vault-count');
const btnCreateProject = document.getElementById('btn-create-project');
const timeline = document.getElementById('timeline');

// Modal Accessors
const projectModal = document.getElementById('project-modal');
const taskModal = document.getElementById('task-modal');
const quickViewModal = document.getElementById('quick-view-modal');
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
    const { data: rData, error: rErr } = await supabaseClient.from('task_repository').select('*');

    if (pErr) console.error('Projects fail:', pErr);
    if (tErr) console.error('Tasks fail:', tErr);

    projects = (pData || []).map(p => ({
        ...p,
        column: p.phase_column,
        createdAt: p.created_at,
        updatedAt: p.updated_at
    }));

    tasks = (tData || []).map(t => ({
        ...t,
        projectId: t.project_id,
        createdAt: t.created_at
    }));

    // Handle Pre-Tasks Repository
    if (rData && rData.length > 0) {
        preTasks = rData;
    } else {
        preTasks = FALLBACK_COMMON_TASKS.map((name, i) => ({ id: `temp-${i}`, name }));
    }
}

function setupEventListeners() {
    // Sidebar Toggle
    // Sidebar Toggle (Mobile & Desktop)
    toggleSidebarBtn.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('mobile-open');
            document.getElementById('sidebar-overlay').classList.toggle('active');
        } else {
            sidebar.classList.toggle('collapsed');
            const icon = toggleSidebarBtn.querySelector('.material-symbols-outlined');
            icon.textContent = sidebar.classList.contains('collapsed') ? 'menu' : 'menu_open';
        }
    });

    const sidebarOverlay = document.getElementById('sidebar-overlay');
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            sidebarOverlay.classList.remove('active');
        });
    }

    // Sidebar Tabs
    const tabProjects = document.getElementById('tab-projects');
    const tabTasks = document.getElementById('tab-tasks');
    if (tabProjects && tabTasks) {
        tabProjects.addEventListener('click', () => {
            activeSidebarTab = 'projects';
            tabProjects.classList.add('active');
            tabTasks.classList.remove('active');
            projectList.classList.remove('hidden');
            taskRepoList.classList.add('hidden');
            document.getElementById('project-sort-row').classList.remove('hidden');
            renderSidebar();
        });
        tabTasks.addEventListener('click', () => {
            activeSidebarTab = 'tasks';
            tabTasks.classList.add('active');
            tabProjects.classList.remove('active');
            projectList.classList.add('hidden');
            taskRepoList.classList.remove('hidden');
            document.getElementById('project-sort-row').classList.add('hidden');
            renderSidebar();
        });
    }

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
        const taskId = document.getElementById('edit-task-id').value;
        const projectId = document.getElementById('task-project-id').value;
        const phase = document.getElementById('task-phase').value;
        const title = document.getElementById('task-title').value;
        const labelsRaw = document.getElementById('task-labels').value;
        const labels = labelsRaw.split(',').map(l => l.trim()).filter(l => l !== '');

        if (taskId) {
            await updateTask(taskId, { project_id: projectId, phase, title, labels });
        } else {
            await addTask(projectId, phase, title, labels);
        }
        closeModals();
    });

    const btnAddPre = document.getElementById('btn-add-pre-task');
    if (btnAddPre) {
        btnAddPre.addEventListener('click', () => {
            console.log('Add Pre-Task clicked');
            openPreTaskModal();
        });
    }

    // Pre-Task Form Submit
    const preTaskForm = document.getElementById('pre-task-form');
    if (preTaskForm) {
        preTaskForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-pre-task-id').value;
            const name = document.getElementById('pre-task-name').value;

            let success = false;
            if (id) success = await updatePreTask(id, name);
            else success = await addPreTask(name);

            if (success) closeModals();
        });
    }

    // Project Search
    const vaultSearch = document.getElementById('vault-search');
    const sortSelect = document.getElementById('project-sort');

    if (vaultSearch) {
        vaultSearch.addEventListener('input', () => {
            renderSidebar(vaultSearch.value, sortSelect?.value || 'newest');
        });
    }

    // Project Sort
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            renderSidebar(vaultSearch?.value || '', e.target.value);
        });
    }

    // Drop zone for clearing milestones (returning project to vault)
    projectList.addEventListener('dragover', (e) => {
        e.preventDefault();
        projectList.style.background = '#F1F5F9';
    });
    projectList.addEventListener('dragleave', () => {
        projectList.style.background = 'transparent';
    });
    projectList.addEventListener('drop', (e) => {
        e.preventDefault();
        projectList.style.background = 'transparent';
        const id = e.dataTransfer.getData('project') || e.dataTransfer.getData('text/plain');
        if (id) moveProject(id, null);
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            reHydrateAndRender();
        }
        if (e.altKey && e.key === 'n') {
            e.preventDefault();
            openProjectModal();
        }
    });

    // View Toggles
    const btnVertical = document.getElementById('btn-view-vertical');
    const btnTable = document.getElementById('btn-view-table');
    const btnSync = document.getElementById('btn-sync-sheet');
    const btnRecords = document.getElementById('btn-view-records');
    const btnRecordsHeader = document.getElementById('btn-view-records-header');

    if (btnVertical && btnTable) {
        btnVertical.addEventListener('click', () => {
            currentView = 'vertical';
            selectedRecordProject = null;
            btnVertical.classList.add('active');
            btnTable.classList.remove('active');
            if (btnRecordsHeader) btnRecordsHeader.classList.remove('active');
            renderActiveView();
        });
        btnTable.addEventListener('click', () => {
            currentView = 'table';
            selectedRecordProject = null;
            btnTable.classList.add('active');
            btnVertical.classList.remove('active');
            if (btnRecordsHeader) btnRecordsHeader.classList.remove('active');
            renderActiveView();
        });
    }

    const switchToRecords = () => {
        currentView = 'records';
        selectedRecordProject = null;
        if (btnTable) btnTable.classList.remove('active');
        if (btnVertical) btnVertical.classList.remove('active');
        if (btnRecordsHeader) btnRecordsHeader.classList.add('active');
        renderActiveView();
    };

    if (btnRecords) btnRecords.addEventListener('click', switchToRecords);
    if (btnRecordsHeader) btnRecordsHeader.addEventListener('click', switchToRecords);

    if (btnSync) {
        btnSync.addEventListener('click', () => syncGoogleSheets());
    }


    // Theme Toggle
    const btnTheme = document.getElementById('btn-toggle-theme');
    const themeIcon = document.getElementById('theme-icon');
    if (btnTheme) {
        btnTheme.addEventListener('click', () => {
            const isDark = document.body.parentElement.getAttribute('data-theme') === 'dark';
            document.body.parentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
            themeIcon.textContent = isDark ? 'dark_mode' : 'light_mode';
            localStorage.setItem('plc-theme', isDark ? 'light' : 'dark');
        });

        // Initial load
        const saved = localStorage.getItem('plc-theme');
        if (saved === 'dark') {
            document.body.parentElement.setAttribute('data-theme', 'dark');
            themeIcon.textContent = 'light_mode';
        }
    }
}

// Project Operations
// Project Operations
async function addProject(name, type, status = 'In Progress', priority = 'Medium') {
    const allPool = ['JD', 'SK', 'MP', 'AL', 'BV'];
    const count = Math.floor(Math.random() * 2) + 1;
    const members = allPool.sort(() => 0.5 - Math.random()).slice(0, count);

    const { error } = await supabaseClient.from('projects').insert([{
        name, type, status, priority, members,
        phase_column: null
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
    else {
        showToast('Updated', 'Project metrics refined.');
        if (column === 'Live') {
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#6366F1', '#10B981', '#F59E0B'] });
        }
    }
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

    const { error } = await supabaseClient.from('projects')
        .update({ phase_column: column, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) showToast('Transfer Blocked', 'Failed to move project.', true);
    else {
        showToast('Location Refined', column ? `Moved to ${column}` : 'Returned to Vault');
        if (column === 'Live') {
            confetti({
                particleCount: 150,
                spread: 70,
                origin: { y: 0.6 },

                colors: ['#6366F1', '#EC4899', '#10B981']
            });
        }
    }
    await reHydrateAndRender();
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

async function updateTask(id, updates) {
    const { error } = await supabaseClient.from('tasks')
        .update(updates)
        .eq('id', id);
    if (error) showToast('Sync Failure', 'Task revisions could not be posted.', true);
    else showToast('Updated', 'Record committed to database.');
    await reHydrateAndRender();
}

async function updateTaskStatus(id, newStatus = null) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    let targetStatus = newStatus;
    if (!targetStatus) {
        const order = ['Open', 'Ongoing', 'Closed'];
        let current = task.status;
        if (current === 'In Progress' || current === 'Progress') current = 'Ongoing';
        if (current === 'Done' || current === 'Completed') current = 'Closed';

        let nextIdx = order.indexOf(current);
        if (nextIdx === -1) nextIdx = 0;
        else nextIdx = (nextIdx + 1) % order.length;
        targetStatus = order[nextIdx];
    }

    const { error } = await supabaseClient.from('tasks')
        .update({ status: targetStatus })
        .eq('id', id);

    if (error) showToast('Status Fail', 'Failed to update task state.', true);
    await reHydrateAndRender();
}

async function deleteTask(id) {
    // Optimistic UI: Remove from local state immediately
    tasks = tasks.filter(t => t.id !== id);
    renderActiveView();
    if (qvPhase && qvType && !quickViewModal.classList.contains('hidden')) {
        refreshQuickView();
    }

    const { error } = await supabaseClient.from('tasks').delete().eq('id', id);
    if (error) {
        console.error('Delete Task Fail:', error);
        showToast('Sync Error', `Could not delete task: ${error.message}`, true);
        await reHydrateAndRender(); // Revert on failure
    } else {
        showToast('Task Removed', 'Record deleted successfully.');
        // No need to re-render here as optimistic UI already did it
    }
}

// Inline Editing Logic
function startInlineEdit(id) {
    // Find all occurrences (Dashboard Table, Timeline, and Quick View Popups)
    const allInstances = document.querySelectorAll(`[id="task-row-${id}"], [id="task-item-${id}"]`);

    allInstances.forEach(container => {
        const text = container.querySelector('.task-name-txt, .task-title-text');
        const input = container.querySelector('.task-edit-input');
        if (text && input) {
            text.classList.add('hidden');
            input.classList.remove('hidden');
            input.focus();
            input.select();
        }
    });
}

function cancelInlineEdit(id) {
    setTimeout(() => {
        const allInstances = document.querySelectorAll(`[id="task-row-${id}"], [id="task-item-${id}"]`);
        allInstances.forEach(container => {
            const text = container.querySelector('.task-name-txt, .task-title-text');
            const input = container.querySelector('.task-edit-input');
            if (text && input) {
                text.classList.remove('hidden');
                input.classList.add('hidden');
            }
        });
    }, 200);
}

async function handleTaskKey(e, id) {
    if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (val) {
            await updateTask(id, { title: val });
        }
        cancelInlineEdit(id);
    } else if (e.key === 'Escape') {
        cancelInlineEdit(id);
    }
}

// Rendering
function renderSidebar(searchQuery = '', sortBy = 'newest') {
    if (!projectList || !taskRepoList) return;

    if (activeSidebarTab === 'projects') {
        renderProjectSidebar(searchQuery, sortBy);
    } else {
        renderTaskSidebar(searchQuery, sortBy);
    }
}

function renderProjectSidebar(searchQuery = '', sortBy = 'newest') {
    projectList.innerHTML = '';
    const tabProj = document.getElementById('tab-projects');
    if (tabProj) {
        tabProj.innerHTML = `Projects <span class="tab-badge">${projects.length}</span>`;
    }

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
        projectList.innerHTML = `<div class="empty-state">No matches found</div>`;
        return;
    }

    const highlight = (str) => {
        if (!searchQuery.trim()) return str;
        const reg = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return str.replace(reg, '<mark class="highlight">$1</mark>');
    };

    processed.forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card project-pill';
        card.draggable = true;
        card.title = project.name; // Tooltip for collapsed mode
        const hue = getProjectHue(project.name);
        card.style.backgroundColor = `hsl(${hue}, 85%, 95%)`;
        card.style.borderColor = `hsl(${hue}, 50%, 85%)`;
        card.style.color = `hsl(${hue}, 90%, 25%)`;

        card.innerHTML = `
            <span class="project-name">${highlight(project.name)}</span>
            <div class="project-card-actions">
                <button class="mini-btn edit-q" style="color: inherit;"><span class="material-symbols-outlined" style="font-size:14px">edit</span></button>
                <button class="mini-btn del-q" style="color: inherit;"><span class="material-symbols-outlined" style="font-size:14px">delete</span></button>
            </div>
        `;

        card.onclick = () => openProjectModal(project.id);
        card.querySelector('.edit-q').onclick = (e) => { e.stopPropagation(); openProjectModal(project.id); };
        card.querySelector('.del-q').onclick = (e) => { e.stopPropagation(); if (confirm(`Delete ${project.name}?`)) deleteProject(project.id); };

        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('project', project.id);
            card.style.opacity = '0.5';
        });
        card.addEventListener('dragend', () => { card.style.opacity = '1'; });
        projectList.appendChild(card);
    });
}

function switchSidebarTab(tab) {
    activeSidebarTab = tab;
    const btnAddPre = document.getElementById('btn-add-pre-task');
    const sortSel = document.getElementById('project-sort');

    document.getElementById('tab-projects').classList.toggle('active', tab === 'projects');
    document.getElementById('tab-tasks').classList.toggle('active', tab === 'tasks');

    projectList.classList.toggle('hidden', tab !== 'projects');
    taskRepoList.classList.toggle('hidden', tab !== 'tasks');

    if (btnAddPre) btnAddPre.classList.toggle('hidden', tab !== 'tasks');
    if (sortSel) sortSel.classList.toggle('hidden', tab !== 'projects');

    renderSidebar();
}

function renderTaskSidebar(searchQuery = '', sortBy = 'newest') {
    taskRepoList.innerHTML = '';
    let filtered = preTasks.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()));

    document.getElementById('pre-task-count').textContent = preTasks.length;

    // Sorting Logic
    filtered.sort((a, b) => {
        if (sortBy === 'alpha') return a.name.localeCompare(b.name);
        // For 'newest', templates from DB will have IDs, fallbacks don't.
        // We'll treat fallback as oldest.
        const idA = String(a.id);
        const idB = String(b.id);
        if (idA.startsWith('temp-') && !idB.startsWith('temp-')) return 1;
        if (!idA.startsWith('temp-') && idB.startsWith('temp-')) return -1;
        return idB.localeCompare(idA); // Descending ID as proxy for newest
    });

    if (filtered.length === 0) {
        taskRepoList.innerHTML = `<div class="empty-state">No templates found</div>`;
        return;
    }

    filtered.forEach(task => {
        const item = document.createElement('div');
        item.className = 'task-item-pill';
        item.draggable = true;
        item.title = task.name; // Tooltip for collapsed mode
        item.innerHTML = `
            <span class="material-symbols-outlined" style="font-size:16px; color: var(--brand-primary);">assignment</span>
            <span class="repo-task-name">${task.name}</span>
            <div class="repo-item-actions">
                <button class="mini-btn edit-repo" title="Edit Template"><span class="material-symbols-outlined" style="font-size:14px">edit</span></button>
                <button class="mini-btn del-repo" title="Delete Template"><span class="material-symbols-outlined" style="font-size:14px">delete</span></button>
            </div>
        `;

        item.querySelector('.edit-repo').onclick = (e) => { e.stopPropagation(); openPreTaskModal(task.id); };
        item.querySelector('.del-repo').onclick = (e) => { e.stopPropagation(); if (confirm(`Delete "${task.name}" template?`)) deletePreTask(task.id); };

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('common-task', task.name);
            item.style.opacity = '0.5';
        });
        item.addEventListener('dragend', () => { item.style.opacity = '1'; });

        taskRepoList.appendChild(item);
    });
}

function openPreTaskModal(id = null) {
    const modal = document.getElementById('pre-task-modal');
    if (!modal) {
        console.error('Pre-Task Modal element not found!');
        return;
    }
    const formId = document.getElementById('edit-pre-task-id');
    const formName = document.getElementById('pre-task-name');
    const titleEl = modal.querySelector('.modal-title');
    const submitText = document.getElementById('pre-task-submit-text');

    if (id) {
        const task = preTasks.find(t => t.id === id);
        titleEl.innerHTML = `Edit <span class="accent">Template</span>`;
        if (submitText) submitText.textContent = 'Save Changes';
        formId.value = id;
        formName.value = task.name || '';
    } else {
        titleEl.innerHTML = `New <span class="accent">Template</span>`;
        if (submitText) submitText.textContent = 'Save to Repository';
        formId.value = '';
        formName.value = '';
    }
    modal.classList.remove('hidden');
    formName.focus();
}

async function addPreTask(name) {
    const { error } = await supabaseClient.from('task_repository').insert([{ name }]);
    if (error) {
        console.error('Add Template Fail:', error);
        showToast('Sync Error', `Could not create template: ${error.message}`, true);
        return false;
    } else {
        showToast('Repository Updated', 'New task template added.');
        await reHydrateAndRender();
        return true;
    }
}

async function updatePreTask(id, name) {
    if (String(id).startsWith('temp-')) {
        showToast('Action Blocked', 'Cannot edit default templates. Create a new one instead.', true);
        return false;
    }
    const { error } = await supabaseClient.from('task_repository').update({ name }).eq('id', id);
    if (error) {
        console.error('Update Template Fail:', error);
        showToast('Sync Error', `Could not update template: ${error.message}`, true);
        return false;
    } else {
        showToast('Updated', 'Template revisions saved.');
        await reHydrateAndRender();
        return true;
    }
}

async function deletePreTask(id) {
    if (String(id).startsWith('temp-')) {
        showToast('Action Blocked', 'Cannot delete default templates.', true);
        return;
    }
    // Optimistic UI
    preTasks = preTasks.filter(t => t.id !== id);
    renderSidebar();

    const { error } = await supabaseClient.from('task_repository').delete().eq('id', id);
    if (error) {
        console.error('Delete Template Fail:', error);
        showToast('Sync Error', `Could not remove template: ${error.message}`, true);
        await reHydrateAndRender();
    } else {
        showToast('Removed', 'Template deleted from repository.');
    }
}

async function deleteProject(id) {
    // Optimistic UI
    projects = projects.filter(p => p.id !== id);
    tasks = tasks.filter(t => t.projectId !== id); // Cascading optimistic removal
    renderSidebar();
    renderActiveView();
    if (qvPhase && qvType && !quickViewModal.classList.contains('hidden')) {
        refreshQuickView();
    }

    // 1. Delete associated tasks first
    await supabaseClient.from('tasks').delete().eq('project_id', id);
    // 2. Delete project
    const { error } = await supabaseClient.from('projects').delete().eq('id', id);

    if (error) {
        console.error('Delete Project Fail:', error);
        showToast('Sync Error', `Could not delete project: ${error.message}`, true);
        await reHydrateAndRender();
    } else {
        showToast('Project Removed', 'Project and its tasks have been cleared.');
    }
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
    updateStats();
    if (currentView === 'table') {
        renderTableView();
    } else if (currentView === 'records') {
        renderRecordsView();
    } else {
        renderTimeline();
    }
}

function updateStats() {
    const totalProjects = projects.length;
    const liveProjects = projects.filter(p => p.column === 'Live').length;
    const activeProjects = projects.filter(p => p.column && p.column !== 'Live').length;

    document.getElementById('stat-total-projects').textContent = totalProjects;
    document.getElementById('stat-live-count').textContent = liveProjects;
    document.getElementById('stat-active-projects').textContent = activeProjects;
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
                                 ${colProjects.length > 0 ? colProjects.map(p => `<div style="font-size:9px;opacity:0.9;">&#8226; ${p.name}</div>`).join('') : '<div style="font-size:9px;opacity:0.5;">- Ready -</div>'}
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
                                <div class="task-item" id="task-item-${task.id}">
                                    <div class="task-title-row">
                                        <div class="task-content">
                                            <span style="color: #94A3B8; font-weight: 600;">#${i + 1}</span>
                                            <span class="task-title-text" onclick="startInlineEdit('${task.id}')">${task.title}</span>
                                            <input type="text" class="task-edit-input hidden" value="${task.title}" onkeyup="handleTaskKey(event, '${task.id}')" onblur="cancelInlineEdit('${task.id}')">
                                            <div class="task-subtitle">${project ? project.name : 'Standalone'}</div>
                                        </div>
                                        <div class="task-actions-group">
                                            <button class="task-action-ico edit-trigger" onclick="startInlineEdit('${task.id}')">
                                                <span class="material-symbols-outlined">edit</span>
                                            </button>
                                            <button class="task-action-ico danger" onclick="if(confirm('Delete task?')) deleteTask('${task.id}')">
                                                <span class="material-symbols-outlined">delete</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="task-badge-row">${labelHTML}</div>
                                    <div class="task-action-footer">
                                        <select class="task-status-select st-${task.status.toLowerCase()}" onchange="updateTaskStatus('${task.id}', this.value)">
                                            <option value="Open" ${task.status === 'Open' ? 'selected' : ''}>Open</option>
                                            <option value="Ongoing" ${task.status === 'Ongoing' || task.status === 'In Progress' ? 'selected' : ''}>Ongoing</option>
                                            <option value="Closed" ${task.status === 'Closed' ? 'selected' : ''}>Closed</option>
                                        </select>
                                        <div class="task-actions-group">
                                            <button class="task-action-ico" onclick="event.stopPropagation(); openTaskModal('${col}', '${task.id}')">
                                                <span class="material-symbols-outlined" style="font-size: 18px;">edit</span>
                                            </button>
                                            <button class="task-action-ico danger" onclick="event.stopPropagation(); if(confirm('Delete task?')) deleteTask('${task.id}')">
                                                <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
                                            </button>
                                        </div>
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
            const projId = e.dataTransfer.getData('project');
            const commonTask = e.dataTransfer.getData('common-task');

            if (projId) moveProject(projId, col);
            else if (commonTask) promptProjectSelection(col, commonTask);
        });

        // Functional Enhancement: Button toggles expansion
        const detailsBtn = milestone.querySelector('.uiv-btn-primary');
        if (detailsBtn) {
            detailsBtn.onclick = (e) => {
                e.stopPropagation();
                toggleCard(card);
            };
        }

        flowWrapper.appendChild(milestone);

    });
    timeline.appendChild(flowWrapper);
}

function renderTableView() {
    timeline.innerHTML = '';
    timeline.className = 'timeline-container table-view-container';

    let html = `
        <div class="milestone-table-wrapper">
            <table class="milestone-table">
                <thead>
                    <tr>
                        <th width="180">Milestone</th>
                        <th width="100">Progress</th>
                        <th>Assigned Projects</th>
                        <th>Key Tasks</th>
                        <th width="120">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    COLUMNS.forEach((col, idx) => {
        const colProjects = projects.filter(p => p.column === col);
        const colTasks = tasks.filter(t => t.phase === col);
        const closed = colTasks.filter(t => t.status === 'Closed').length;
        const progress = colTasks.length > 0 ? Math.round((closed / colTasks.length) * 100) : 0;

        const projectsHTML = colProjects.map(p => {
            const hue = getProjectHue(p.name);
            const bg = `hsl(${hue}, 85%, 95%)`;
            const border = `hsl(${hue}, 50%, 85%)`;
            const text = `hsl(${hue}, 90%, 25%)`;

            return `
                <div class="project-stat-container">
                    <span class="table-proj-chip" 
                          style="background-color: ${bg}; border-color: ${border}; color: ${text};"
                          draggable="true" 
                          ondragstart="event.dataTransfer.setData('project', '${p.id}')" 
                          onclick="openProjectModal('${p.id}')">
                        ${p.name}
                        <button class="chip-remove-btn" onclick="event.stopPropagation(); moveProject('${p.id}', null)" title="Return to Vault">&#10005;</button>
                    </span>
                    <div class="project-tooltip">
                        <div class="tooltip-title">${p.name}</div>
                        <div style="font-size: 10px; margin-bottom: 4px;">Type: <b>${p.type || 'Web'}</b></div>
                        <div style="font-size: 10px; margin-bottom: 4px;">Status: <b>${p.status || 'Active'}</b></div>
                        <div style="font-size: 10px;">Priority: <b>${p.priority || 'Medium'}</b></div>
                    </div>
                </div>
            `;
        }).join('');

        const projectToggleHTML = `
            <div class="project-toggle-container">
                <button class="project-count-toggle" onclick="toggleProjectList(this)">
                    <span class="material-symbols-outlined">folder_open</span>
                    ${colProjects.length} Projects
                </button>
                <div class="table-projects-cell hidden">${projectsHTML || '<span class="txt-muted">No projects assigned</span>'}</div>
            </div>
        `;

        const tasksHTML = colTasks.map(t => {
            const stCls = `st-${t.status.toLowerCase()}`;
            const proj = projects.find(p => p.id === t.projectId);
            const projName = proj ? proj.name : 'Unknown';
            const hue = proj ? getProjectHue(projName) : 0;
            const bg = proj ? `hsl(${hue}, 85%, 95%)` : '#F1F5F9';
            const text = proj ? `hsl(${hue}, 90%, 25%)` : '#475569';

            return `
                <div class="table-task-row" id="task-row-${t.id}">
                    <select class="task-status-select st-${t.status.toLowerCase()}" onchange="updateTaskStatus('${t.id}', this.value)">
                        <option value="Open" ${t.status === 'Open' ? 'selected' : ''}>Open</option>
                        <option value="Ongoing" ${t.status === 'Ongoing' || t.status === 'In Progress' ? 'selected' : ''}>Ongoing</option>
                        <option value="Closed" ${t.status === 'Closed' ? 'selected' : ''}>Closed</option>
                    </select>
                    <span class="task-project-tag" style="background-color: ${bg}; color: ${text};" title="Project: ${projName}">${projName}</span>
                    <span class="task-name-txt" onclick="startInlineEdit('${t.id}')">${t.title}</span>
                    <input type="text" class="task-edit-input hidden" value="${t.title}" onkeyup="handleTaskKey(event, '${t.id}')" onblur="cancelInlineEdit('${t.id}')">
                    <div class="table-task-actions">
                        <button class="task-action-ico edit-trigger" onclick="startInlineEdit('${t.id}')">
                            <span class="material-symbols-outlined">edit</span>
                        </button>
                        <button class="task-action-ico danger" onclick="if(confirm('Delete task?')) deleteTask('${t.id}')">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        const taskToggleHTML = `
            <div class="task-toggle-container">
                <button class="task-count-toggle" onclick="toggleTaskList(this)">
                    <span class="material-symbols-outlined">assignment</span>
                    ${colTasks.length} Tasks
                </button>
                <div class="table-tasks-cell hidden">${tasksHTML || '<span class="txt-muted">No tasks assigned</span>'}</div>
            </div>
        `;

        const openCount = colTasks.filter(t => t.status === 'Open').length;
        const progCount = colTasks.filter(t => t.status === 'In Progress').length;
        const closedCount = colTasks.filter(t => t.status === 'Closed').length;
        const total = colTasks.length || 1;

        const openPct = Math.round((openCount / total) * 100);
        const progPct = Math.round((progCount / total) * 100);
        const closedPct = Math.round((closedCount / total) * 100);

        html += `
            <tr class="milestone-tr theme-${idx + 1}" data-phase="${col}">
                <td>
                    <div class="td-phase-header theme-${idx + 1}">
                        <span class="phase-num">${idx + 1}</span>
                        <span class="phase-name">${col} <span class="phase-count-badge" onclick="toggleProjectList(this.closest('tr').querySelector('.project-count-toggle'))" title="Quick View Projects">${colProjects.length}</span></span>
                    </div>
                </td>
                <td>
                    <div class="dist-tooltip">
                        <span><i class="dot dist-open"></i>${openCount}</span>
                        <span><i class="dot dist-progress"></i>${progCount}</span>
                        <span><i class="dot dist-closed"></i>${closedCount}</span>
                    </div>
                    <div class="task-dist-container" title="Tasks: ${openCount} Open, ${progCount} In Progress, ${closedCount} Closed">
                        <div class="dist-seg dist-open" style="width:${openPct}%"></div>
                        <div class="dist-seg dist-progress" style="width:${progPct}%"></div>
                        <div class="dist-seg dist-closed" style="width:${closedPct}%"></div>
                    </div>
                </td>
                <td>
                    <div class="table-projects-cell-wrapper">${projectToggleHTML}</div>
                </td>
                <td>
                    <div class="table-tasks-cell-wrapper">${taskToggleHTML}</div>
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

    document.querySelectorAll('.milestone-tr').forEach(row => {
        row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('row-drag-over'); });
        row.addEventListener('dragleave', () => row.classList.remove('row-drag-over'));
        row.addEventListener('drop', (e) => {
            e.preventDefault(); row.classList.remove('row-drag-over');
            const projectId = e.dataTransfer.getData('project');
            const commonTask = e.dataTransfer.getData('common-task');
            const phase = row.dataset.phase;

            if (projectId) {
                moveProject(projectId, phase);
            } else if (commonTask) {
                promptProjectSelection(phase, commonTask);
            }
        });
    });
}

function promptProjectSelection(phase, taskTitle) {
    const phaseProjects = projects.filter(p => p.column === phase);
    const selectorModal = document.getElementById('project-selector-modal');
    const selectorList = document.getElementById('project-selector-list');
    const selectorSub = document.getElementById('selector-subtitle');

    if (!selectorModal || !selectorList) return;

    if (phaseProjects.length === 0) {
        showToast('No Projects', `Move a project to ${phase} first.`, true);
        return;
    }

    if (selectorSub) selectorSub.textContent = `Assigning "${taskTitle}" to ${phase}`;

    selectorList.innerHTML = phaseProjects.map(p => `
        <button class="uiv-btn-secondary" style="text-align: left; justify-content: flex-start; padding: 12px; font-size: 13px; font-weight: 700;" 
                onclick="assignCommonTask('${p.id}', '${phase}', '${taskTitle}')">
            ${p.name}
        </button>
    `).join('');

    selectorModal.classList.remove('hidden');
}

async function assignCommonTask(projectId, phase, title) {
    closeModals();
    await addTask(projectId, phase, title, []);
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
    switch (type) {
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

function openTaskModal(phase = 'Onboarding', taskId = null) {
    if (projects.length === 0) {
        showToast('Invalid Action', 'Create at least one project first.', true);
        return;
    }

    const taskFormId = document.getElementById('edit-task-id');
    const submitBtn = taskModal.querySelector('button[type="submit"]');
    const titleEl = taskModal.querySelector('.modal-title');
    const projectSelect = document.getElementById('task-project-id');
    const filterInput = document.getElementById('task-project-search');

    // Contextual projects for this phase
    const phaseProjects = projects.filter(p => p.column === phase);

    // Force dynamic option generation once
    const buildOpts = () => {
        const query = filterInput.value.toLowerCase();
        // If it's a new task, only show projects in this phase. If editing, show all just in case.
        const source = taskId ? projects : phaseProjects;
        const options = source
            .filter(p => p.name.toLowerCase().includes(query))
            .map(p => `<option value="${p.id}">${p.name}</option>`)
            .join('');

        projectSelect.innerHTML = options || '<option disabled>No projects in this phase</option>';
    };

    filterInput.value = '';
    filterInput.oninput = buildOpts;
    buildOpts();

    if (taskId) {
        const task = tasks.find(t => t.id === taskId);
        titleEl.innerHTML = `Edit <span class="accent">Task</span>`;
        submitBtn.innerHTML = `
            <span class="material-symbols-outlined">save</span>
            <span>Save Revisions</span>
        `;
        taskFormId.value = taskId;
        projectSelect.value = task.projectId;
        document.getElementById('task-phase').value = task.phase;
        document.getElementById('task-title').value = task.title;
        document.getElementById('task-labels').value = (task.labels || []).join(', ');
    } else {
        titleEl.innerHTML = `Create <span class="accent">Task</span>`;
        submitBtn.innerHTML = `
            <span class="material-symbols-outlined">rocket_launch</span>
            <span>Deploy Task</span>
        `;
        taskFormId.value = '';
        document.getElementById('task-phase').value = phase;
        document.getElementById('task-title').value = '';
        document.getElementById('task-labels').value = '';
    }

    taskModal.classList.remove('hidden');
}

function closeModals() {
    if (projectModal) projectModal.classList.add('hidden');
    if (taskModal) taskModal.classList.add('hidden');

    const preTask = document.getElementById('pre-task-modal');
    if (preTask) preTask.classList.add('hidden');

    if (quickViewModal) quickViewModal.classList.add('hidden');

    const selector = document.getElementById('project-selector-modal');
    if (selector) selector.classList.add('hidden');
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
window.handleGvizSync = async function (response) {
    const syncIcon = document.getElementById('sync-icon');
    try {
        if (!response || !response.table || !response.table.rows) {
            throw new Error("Invalid Gviz payload");
        }

        const rows = response.table.rows;

        // Filter, extract and SANITIZE names (purging garbage CSV lines)
        const sheetNames = rows
            .map(row => {
                if (!row.c || !row.c[0]) return null;
                let val = row.c[0].v;
                if (!val) return null;
                val = String(val).trim();
                // Robust Garbage Defense: ignore long descriptions or multi-comma CSV leaks
                if (val.length > 70 || (val.match(/,/g) || []).length > 2) return null;
                return val;
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
                phase_column: null // Redirected from Onboarding to strictly Vault containment
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
        if (syncIcon) syncIcon.classList.remove('sync-spin');
        // Clean up dynamic script if found
        const old = document.getElementById('gviz-sync-script');
        if (old) old.remove();
    }
};

async function syncGoogleSheets(silent = false) {
    const syncIcon = document.getElementById('sync-icon');
    if (syncIcon) syncIcon.classList.add('sync-spin');

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

function openQuickView(title, subtitle, content) {
    const titleEl = document.getElementById('quick-view-title');
    const subEl = document.getElementById('quick-view-subtitle');
    const contEl = document.getElementById('quick-view-content');

    if (titleEl) titleEl.innerHTML = title.replace(' ', ' <span class="accent">') + '</span>';
    if (subEl) subEl.textContent = subtitle;

    // Wrap content in a styled container
    if (contEl) {
        contEl.innerHTML = `<div class="quick-view-grid-wrap animate-slide-up">${content}</div>`;
    }

    if (quickViewModal) quickViewModal.classList.remove('hidden');
}

function toggleProjectList(btn) {
    if (!btn) return;
    const phase = btn.closest('tr').dataset.phase;
    qvPhase = phase;
    qvType = 'projects';
    refreshQuickView();
}

function toggleTaskList(btn) {
    if (!btn) return;
    const phase = btn.closest('tr').dataset.phase;
    qvPhase = phase;
    qvType = 'tasks';
    refreshQuickView();
}

function refreshQuickView() {
    if (!qvPhase || !qvType) return;
    const row = document.querySelector(`.milestone-tr[data-phase="${qvPhase}"]`);
    if (!row) return;

    if (qvType === 'projects') {
        const list = row.querySelector('.table-projects-cell').innerHTML;
        openQuickView(`${qvPhase} Projects`, 'Active projects in this lifecycle phase', list);
    } else {
        const list = row.querySelector('.table-tasks-cell').innerHTML;
        openQuickView(`${qvPhase} Tasks`, 'Incomplete lifecycle action items', list);
    }
}

let selectedRecordProject = null;

function renderRecordsView() {
    timeline.innerHTML = '';
    timeline.className = 'timeline-container records-view';

    if (selectedRecordProject) {
        renderProjectHistory(selectedRecordProject);
        return;
    }

    const filtered = projects.filter(p => p.name.toLowerCase().includes(recordsSearchQuery.toLowerCase()));
    const totalPages = Math.ceil(filtered.length / RECORDS_PER_PAGE);
    const start = (recordsPage - 1) * RECORDS_PER_PAGE;
    const paged = filtered.slice(start, start + RECORDS_PER_PAGE);

    let html = `
        <div class="records-header">
            <h2>Project <span class="accent">Archives</span></h2>
            <p>Historical audit trails for every vault item.</p>
        </div>
        
        <div class="records-controls">
            <div class="records-search-wrapper">
                <span class="material-symbols-outlined">search</span>
                <input type="text" class="records-search-input" placeholder="Search case files..." 
                       value="${recordsSearchQuery}" oninput="handleRecordsSearch(this.value)">
            </div>
            
            <div class="pagination-controls">
                <button class="pag-btn" ${recordsPage === 1 ? 'disabled' : ''} onclick="changeRecordsPage(${recordsPage - 1})">Previous</button>
                <span class="pag-info">Page ${recordsPage} of ${totalPages || 1}</span>
                <button class="pag-btn" ${recordsPage === totalPages || totalPages === 0 ? 'disabled' : ''} onclick="changeRecordsPage(${recordsPage + 1})">Next</button>
            </div>
        </div>
    `;

    html += '<div class="folder-grid">';

    paged.forEach(p => {
        const hue = getProjectHue(p.name);
        const taskCount = tasks.filter(t => t.projectId === p.id).length;
        html += `
            <div class="folder-card" onclick="viewProjectRecord('${p.id}')">
                <div class="folder-icon" style="color: hsl(${hue}, 70%, 45%)">
                    <span class="material-symbols-outlined" style="font-size: 64px;">folder</span>
                </div>
                <div class="folder-info">
                    <div class="folder-name">${p.name}</div>
                    <div class="folder-meta">${taskCount} Activities Recorded</div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    timeline.innerHTML = html;

    const btnRecords = document.getElementById('btn-view-records');
    if (btnRecords) btnRecords.classList.add('active');
}

function handleRecordsSearch(val) {
    recordsSearchQuery = val;
    recordsPage = 1;
    renderRecordsView();
}

function changeRecordsPage(p) {
    recordsPage = p;
    renderRecordsView();
}

function openQuickView(title, subtitle, content) {
    const modal = document.getElementById('quick-view-modal');
    if (!modal) return;
    document.getElementById('quick-view-title').textContent = title;
    document.getElementById('quick-view-subtitle').textContent = subtitle;
    document.getElementById('quick-view-content').innerHTML = content;
    modal.classList.remove('hidden');
}

function closeQuickView() {
    const modal = document.getElementById('quick-view-modal');
    if (modal) modal.classList.add('hidden');
}



function viewProjectRecord(id) {
    selectedRecordProject = id;
    renderRecordsView();
}

function clearProjectRecord() {
    selectedRecordProject = null;
    renderRecordsView();
}

function renderProjectHistory(id) {
    const project = projects.find(p => p.id === id);
    const projTasks = tasks.filter(t => t.projectId === id);

    let html = `
        <div class="history-view animate-slide-up">
            <div class="history-header">
                <button class="back-btn" onclick="clearProjectRecord()">
                    <span class="material-symbols-outlined">arrow_back</span> Back to Archives
                </button>
                <div class="history-title">
                    <h3>${project ? project.name : 'Unknown Project'} <span class="accent">Case File</span></h3>
                    <p>Complete activity ledger and task history.</p>
                </div>
            </div>
            
            <div class="history-table-wrapper">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Activity Date</th>
                            <th>Phase</th>
                            <th>Task Specification</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    if (projTasks.length === 0) {
        html += '<tr><td colspan="4" style="text-align:center; padding: 40px; color: var(--brand-text-muted);">No activity history found for this project.</td></tr>';
    } else {
        projTasks.forEach(t => {
            const dateStr = t.createdAt || project.updatedAt || project.createdAt;
            const date = dateStr ? new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Fresh';
            const statusCls = `st-${t.status.toLowerCase()}`;
            html += `
                <tr>
                    <td><span class="history-date">${date}</span></td>
                    <td><span class="history-phase">${t.phase}</span></td>
                    <td><span class="history-task">${t.title}</span></td>
                    <td><span class="task-status-indicator ${statusCls}">${t.status}</span></td>
                </tr>
            `;
        });
    }

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;
    timeline.innerHTML = html;
}

// Start the Application
reHydrateAndRender();

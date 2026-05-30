// ── 상태 및 전역 변수 ───────────────────────────────────
let state = { memos: [], folders: ['기본'], tags: [] };
let currentMemoId = null;
let lastValidMemoId = null; 
let activeFolder = '__all__';
let lastActiveFolder = '__all__';
let activeTags = []; 
let editingFolder = null; 
let pendingCategory = null; 
let searchQuery = '';
let saveTimer = null;
let sidebarTimer = null;
let cleanupTimer = null;

// ── 유틸리티 ──────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const fmt = (d) => {
  const date = new Date(d);
  if (isNaN(date.getTime())) return 'N/A';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d_ = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d_}`;
};

function plainText(html) {
  if (!html || typeof html !== 'string') return '';
  let text = html.replace(/<br[^>]*>|<\/div>|<\/p>|<\/li>/gi, ' ');
  text = text.replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

// ── 알림 및 모달 ──────────────────────────────────────
function showToast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.remove('show'), 2500);
}

function showConfirm(title, message, onOk) {
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmModal').classList.add('show');
  const okBtn = $('confirmOk');
  const cancelBtn = $('confirmCancel');
  const cleanUp = () => {
    $('confirmModal').classList.remove('show');
    okBtn.onclick = null;
    cancelBtn.onclick = null;
  };
  okBtn.onclick = () => { cleanUp(); if (onOk) onOk(); };
  cancelBtn.onclick = () => { cleanUp(); };
}

function showAlert(title, message) {
  $('alertTitle').textContent = title;
  $('alertMessage').textContent = message;
  $('alertModal').classList.add('show');
  const okBtn = $('alertOk');
  okBtn.onclick = () => { $('alertModal').classList.remove('show'); };
}

function showFolderError(msg) {
  const el = $('folderErrorMsg');
  if (msg) {
    el.textContent = msg;
    el.style.display = 'block';
    $('folderNameInput').style.borderColor = 'var(--danger)';
  } else {
    el.style.display = 'none';
    $('folderNameInput').style.borderColor = 'var(--border)';
  }
}

// ── 데이터 관리 ───────────────────────────────────────
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveData, 600); }
async function saveData() { 
  await window.api.saveData(state);
  requestCleanupImages();
}

function requestCleanupImages() {
  clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(async () => {
    await window.api.cleanupImages(state.memos);
  }, 5000);
}

// ── 메모 CRUD ────────────────────────────────────────
function newMemo(forcedCategory) {
  currentMemoId = null; 
  pendingCategory = (typeof forcedCategory === 'string') ? forcedCategory : (activeFolder === '__all__' || activeFolder === '__trash__' ? '기본' : activeFolder);
  
  clearEditor();
  const sel = $('editor-folder');
  if (sel) sel.value = pendingCategory;
  
  closeDrawer();
  $('editor-title').focus();
}

function deleteMemo(id) {
  const memo = state.memos.find(m => m.id === id);
  if (!memo) return;

  if (memo.deleted) {
    showConfirm('영구 삭제', '이 메모를 영구적으로 삭제하시겠습니까?', () => {
      state.memos = state.memos.filter(m => m.id !== id);
      if (currentMemoId === id) { 
        currentMemoId = null; 
        const trashList = state.memos.filter(m => m.deleted);
        if (trashList.length > 0) selectMemo(trashList[0].id);
        else {
          showToast('휴지통이 비었습니다.');
          newMemo(activeFolder === '__trash__' ? '기본' : activeFolder);
        }
      }
      scheduleSave();
      renderAll();
    });
  } else {
    memo.deleted = true;
    memo.deletedAt = Date.now();
    showToast('메모를 휴지통으로 옮겼습니다.');
    if (currentMemoId === id) {
      currentMemoId = null;
      const nextList = filteredMemos();
      if (nextList.length > 0) {
        selectMemo(nextList[0].id);
      } else {
        newMemo(activeFolder === '__all__' ? '기본' : activeFolder);
      }
    }
    scheduleSave();
    renderAll();
  }
}

function restoreMemo(id) {
  const memo = state.memos.find(m => m.id === id);
  if (!memo) return;
  memo.deleted = false;
  delete memo.deletedAt;
  showToast('메모를 복구했습니다.');
  scheduleSave();
  renderAll();
  selectMemo(id);
}

function emptyTrash() {
  const trashList = state.memos.filter(m => m.deleted);
  if (trashList.length === 0) return;
  showConfirm('휴지통 비우기', `정말로 휴지통을 비우시겠습니까?`, () => {
    const currentMemo = state.memos.find(m => m.id === currentMemoId);
    const wasViewingTrashMemo = currentMemo && currentMemo.deleted;
    
    state.memos = state.memos.filter(m => !m.deleted);
    
    // 휴지통 가기 전 혹은 현재 보고 있는 유효 메모의 카테고리로 유지
    activeFolder = lastActiveFolder;
    
    if (wasViewingTrashMemo || !currentMemoId) {
      // 휴지통 메모를 보고 있었거나 선택된 메모가 없었다면 해당 카테고리의 새 메모 상태로
      newMemo(activeFolder === '__all__' ? '기본' : activeFolder);
    }
    
    showToast('휴지통을 비웠습니다.');
    scheduleSave();
    renderAll();
  });
}

function deleteFolder(folderName) {
  if (folderName === '기본') return;
  
  const performDelete = () => {
    state.folders = state.folders.filter(f => f !== folderName);
    state.memos.forEach(m => { if (m.folder === folderName && !m.deleted) { m.deleted = true; m.deletedAt = Date.now(); } });
    if (activeFolder === folderName) activeFolder = '__all__';
    showToast(`카테고리 '${folderName}'를 삭제했습니다.`);
    scheduleSave(); renderAll();
    if (!currentMemoId) newMemo(); 
  };

  const activeMemosCount = state.memos.filter(m => m.folder === folderName && !m.deleted).length;
  if (activeMemosCount === 0) performDelete();
  else showConfirm('카테고리 삭제', '카테고리를 삭제하시겠습니까? 해당 카테고리의 메모는 휴지통으로 이동됩니다.', performDelete);
}

// ── 에디터 제어 ──────────────────────────────────────
function selectMemo(id) {
  currentMemoId = id;
  pendingCategory = null; 
  const memo = state.memos.find(m => m.id === id);
  if (!memo) return;
  
  const editor = $('editor');
  const parent = editor.parentNode;
  const next = editor.nextSibling;
  parent.removeChild(editor);
  parent.insertBefore(editor, next);
  
  $('editor-title').value = memo.title || '';
  editor.innerHTML = memo.content || '';
  
  const sel = $('editor-folder');
  if (sel) sel.value = memo.folder;
  
  if (!memo.deleted) lastValidMemoId = id;
  if (window.api?.saveLastMemo) window.api.saveLastMemo(id);
  
  const isTrash = !!memo.deleted;
  $('trash-btns').style.display = isTrash ? 'flex' : 'none';
  $('deleteBtn').style.display = isTrash ? 'none' : 'block';
  $('editor').contentEditable = !isTrash;
  $('editor-title').disabled = isTrash;
  $('editor-folder').disabled = isTrash;
  
  renderCurrentTags(memo.tags);
  updateStatus(memo);
  updateNameChip(memo);
  renderMemoList();

  setTimeout(() => {
    const activeItem = document.querySelector('.memo-item.active');
    if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);

  closeDrawer();
}

function clearEditor() {
  $('editor-title').value = '';
  $('editor-title').disabled = false;
  
  const editor = $('editor');
  editor.innerHTML = ''; // 플레이스홀더 표시를 위해 완전히 비움
  editor.contentEditable = true;
  
  // 에디터 서식 상태 초기화
  editor.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  
  // 서식 초기화 (명시적으로 명령 해제)
  document.execCommand('removeFormat', false, null);
  const commands = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'];
  commands.forEach(cmd => {
    if (document.queryCommandState(cmd)) document.execCommand(cmd, false, null);
  });

  document.querySelectorAll('[data-cmd]').forEach(btn => btn.classList.remove('active'));
  $('font-size-select').value = '3';
  
  $('editor-folder').disabled = false;
  
  const targetVal = pendingCategory || ((activeFolder === '__all__' || activeFolder === '__trash__') ? '기본' : activeFolder);
  const selFolder = $('editor-folder');
  if (selFolder) selFolder.value = targetVal;
  
  $('trash-btns').style.display = 'none';
  $('deleteBtn').style.display = 'block';
  renderCurrentTags([]);
  $('status-text').textContent = fmt(Date.now());
  $('memo-name-chip').textContent = '';
}

function updateCurrentMemo(force = false) {
  const title = $('editor-title').value;
  const content = $('editor').innerHTML;

  if (!currentMemoId) {
    // 서식만 있는 경우(태그만 있는 경우)도 내용으로 인정하기 위해 체크 강화
    const hasVisibleContent = title.trim() || plainText(content).trim() || content.includes('<img') || content.includes('<li') || content.includes('<b') || content.includes('<i') || content.includes('<u') || content.includes('<s');
    
    if (force || hasVisibleContent) {
      const targetFolder = $('editor-folder').value || pendingCategory || '기본';
      const newM = {
        id: uid(), title: title, content: content,
        folder: targetFolder,
        tags: [], createdAt: Date.now(), updatedAt: Date.now(),
      };
      state.memos.unshift(newM);
      currentMemoId = newM.id;
      pendingCategory = null;
      activeFolder = targetFolder; 
      renderAll();
    } else return;
  }

  const memo = state.memos.find(m => m.id === currentMemoId);
  if (!memo || memo.deleted) return;
  
  memo.title = title;
  memo.content = content;
  
  const selectedFolder = $('editor-folder').value;
  if (selectedFolder) memo.folder = selectedFolder;
  
  memo.updatedAt = Date.now();
  updateStatus(memo);
  updateNameChip(memo);
  renderMemoListDebounced();
  scheduleSave();
}

function updateStatus(memo) {
  const time = memo.deleted ? memo.deletedAt : memo.updatedAt;
  $('status-text').textContent = (memo.deleted ? '삭제됨: ' : '') + fmt(time);
}

function updateNameChip(memo) {
  $('memo-name-chip').textContent = memo.title || '제목 없음';
}

// ── 렌더링 및 검색 ─────────────────────────────────────
function renderMemoListDebounced() { clearTimeout(sidebarTimer); sidebarTimer = setTimeout(renderMemoList, 300); }

function highlightText(text, query) {
  if (!text) return '';
  const safeText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!query) return safeText;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return safeText.replace(regex, '<mark>$1</mark>');
}

function filteredMemos() {
  let list = [...state.memos].filter(m => m && typeof m === 'object');
  if (activeFolder === '__trash__') list = list.filter(m => m.deleted);
  else {
    list = list.filter(m => !m.deleted);
    if (activeFolder !== '__all__') list = list.filter(m => m.folder === activeFolder);
  }
  if (activeTags.length > 0) list = list.filter(m => activeTags.every(t => (m.tags || []).includes(t)));
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(m =>
      (m.title || '').toLowerCase().includes(q) ||
      plainText(m.content).toLowerCase().includes(q) ||
      (m.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  return list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const timeA = a.deleted ? a.deletedAt : a.updatedAt;
    const timeB = b.deleted ? b.deletedAt : b.updatedAt;
    return (timeB || 0) - (timeA || 0);
  });
}

function renderMemoList() {
  const list = filteredMemos();
  const el = $('memo-list');
  if (!el) return;
  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text3);font-size:11px;">${activeFolder === '__trash__' ? '휴지통이 비어 있습니다' : '메모 없음'}</div>`;
    return;
  }
  list.forEach(memo => {
    const div = document.createElement('div');
    div.className = 'memo-item' + (memo.id === currentMemoId ? ' active' : '');
    div.draggable = true;
    div.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', memo.id); });
    
    const tagsHtml = (memo.tags || []).map(t => `<span class="tag-chip" data-tag="${t}">#${t}</span>`).join('');
    const pinHtml = memo.deleted ? '' : `<div class="pin-btn ${memo.pinned ? 'pinned' : ''}" title="상단 고정">📌</div>`;
    
    const highlightedTitle = highlightText(memo.title || '제목 없음', searchQuery);
    let pt = plainText(memo.content);
    let preview = pt.slice(0, 50);
    const highlightedPreview = highlightText(preview, searchQuery);

    div.innerHTML = `${pinHtml}<div class="memo-title" style="padding-right: 16px;">${highlightedTitle}</div>
      <div class="memo-date">${fmt(memo.deleted ? memo.deletedAt : memo.updatedAt)}</div>
      <div class="memo-preview">${highlightedPreview}</div>
      ${tagsHtml ? `<div class="memo-tags">${tagsHtml}</div>` : ''}`;
    
    const pinBtn = div.querySelector('.pin-btn');
    if (pinBtn) pinBtn.addEventListener('click', (e) => { e.stopPropagation(); memo.pinned = !memo.pinned; scheduleSave(); renderAll(); });
    
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('tag-chip')) {
        e.stopPropagation();
        const tag = e.target.dataset.tag;
        if (!activeTags.includes(tag)) { activeTags.push(tag); renderAll(); }
      } else selectMemo(memo.id);
    });
    el.appendChild(div);
  });
}

function renderFolders() {
  const el = $('folder-list'), sel = $('editor-folder');
  if (!el || !sel) return;
  el.innerHTML = '';
  
  const allDiv = document.createElement('div');
  allDiv.className = 'drawer-item' + (activeFolder === '__all__' ? ' active' : '');
  allDiv.innerHTML = `<span>📋 전체</span><span class="dcount">${state.memos.filter(m => !m.deleted).length}</span>`;
  allDiv.addEventListener('click', () => { activeFolder = '__all__'; activeTags = []; renderAll(); });
  el.appendChild(allDiv);

  state.folders.forEach(f => {
    const count = state.memos.filter(m => m.folder === f && !m.deleted).length;
    const div = document.createElement('div');
    div.className = 'drawer-item' + (activeFolder === f ? ' active' : '');
    div.innerHTML = `<span>📁 ${f}</span><span class="dcount">${count}</span>`;
    
    div.addEventListener('dragover', e => e.preventDefault());
    div.addEventListener('drop', e => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const memo = state.memos.find(m => m.id === id);
      if (memo && memo.folder !== f) {
        memo.folder = f; memo.deleted = false;
        scheduleSave(); renderAll();
        if (memo.id === currentMemoId) selectMemo(memo.id);
      }
    });

    if (f !== '기본') {
      const delBtn = document.createElement('div');
      delBtn.className = 'folder-delete-btn';
      delBtn.innerHTML = '✕';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteFolder(f); });
      div.appendChild(delBtn);
    }
    div.addEventListener('click', () => { activeFolder = f; activeTags = []; renderAll(); });
    div.addEventListener('dblclick', (e) => {
      if (f === '기본') return;
      e.stopPropagation();
      editingFolder = f;
      $('folderModal').querySelector('h3').textContent = '카테고리 이름 변경';
      $('folderNameInput').value = f;
      showFolderError(null);
      $('folderModal').classList.add('show');
      setTimeout(() => $('folderNameInput').focus(), 50);
    });
    el.appendChild(div);
  });

  sel.innerHTML = state.folders.map(f => `<option value="${f}">${f}</option>`).join('');
  const currentMemo = currentMemoId ? state.memos.find(m => m.id === currentMemoId) : null;
  if (currentMemo) sel.value = currentMemo.folder;
  else if (pendingCategory) sel.value = pendingCategory;
  else sel.value = state.folders.includes(activeFolder) ? activeFolder : '기본';

  setTimeout(() => {
    const activeFolderItem = el.querySelector('.drawer-item.active');
    if (activeFolderItem) activeFolderItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);
}

function renderTrashBin() {
  const el = $('trash-section');
  if (!el) return;
  el.innerHTML = '';
  const trashCount = state.memos.filter(m => m.deleted).length;
  const trashDiv = document.createElement('div');
  trashDiv.className = 'drawer-item' + (activeFolder === '__trash__' ? ' active' : '');
  trashDiv.style.borderTop = '1px solid var(--border)';
  trashDiv.innerHTML = `<span>🗑️ 휴지통</span><span class="dcount">${trashCount}</span>`;
  trashDiv.addEventListener('click', () => { activeFolder = '__trash__'; activeTags = []; renderAll(); });
  trashDiv.addEventListener('dragover', e => e.preventDefault());
  trashDiv.addEventListener('drop', e => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) deleteMemo(id);
  });
  el.appendChild(trashDiv);
}

function renderAll() {
  if (activeFolder !== '__trash__') lastActiveFolder = activeFolder;
  renderFolders();
  renderTrashBin();
  renderTagFilter();
  renderActiveTags();
  renderMemoList();
  
  const labelFolder = $('list-label-folder');
  const newMemoBtn = $('new-memo-btn');
  if (activeFolder === '__trash__') {
    labelFolder.textContent = '휴지통';
    const count = state.memos.filter(m => m.deleted).length;
    newMemoBtn.style.display = count > 0 ? 'inline-flex' : 'none';
    newMemoBtn.textContent = '🗑️ 휴지통 비우기';
    newMemoBtn.style.color = 'var(--danger)';
  } else if (activeFolder === '__all__') {
    labelFolder.textContent = '전체';
    newMemoBtn.style.display = 'none';
  } else {
    labelFolder.textContent = activeFolder;
    newMemoBtn.style.display = 'inline-flex';
    newMemoBtn.textContent = '+ 새 메모';
    newMemoBtn.style.color = 'var(--tag-text)';
  }
}

// ── 태그 시스템 ──────────────────────────────────────
function renderTagFilter() {
  let memos = state.memos.filter(m => !m.deleted);
  if (activeFolder === '__trash__') memos = state.memos.filter(m => m.deleted);
  else if (activeFolder !== '__all__') memos = memos.filter(m => m.folder === activeFolder);
  
  const allTags = [...new Set(memos.flatMap(m => m.tags || []))];
  const el = $('tag-filter-list'), section = $('tag-filter-section');
  if (!el || !section) return;
  el.innerHTML = '';
  if (allTags.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  allTags.forEach(t => {
    const btn = document.createElement('button');
    const isActive = activeTags.includes(t);
    btn.className = 'tag-chip' + (isActive ? ' active' : '');
    btn.textContent = `#${t}`;
    btn.addEventListener('click', () => {
      activeTags = isActive ? activeTags.filter(tag => tag !== t) : [...activeTags, t];
      renderAll();
    });
    el.appendChild(btn);
  });
}

function renderActiveTags() {
  const el = $('active-tag-chips'), section = $('active-tag-section');
  if (!el || !section) return;
  el.innerHTML = '';
  if (activeTags.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  activeTags.forEach(t => {
    const span = document.createElement('span');
    span.className = 'filter-tag-chip';
    span.innerHTML = `#${t} <span class="rm">✕</span>`;
    span.querySelector('.rm').addEventListener('click', (e) => { e.stopPropagation(); activeTags = activeTags.filter(tag => tag !== t); renderAll(); });
    el.appendChild(span);
  });
}

function renderCurrentTags(tags) {
  const el = $('current-tags');
  if (!el) return;
  el.innerHTML = '';
  (tags || []).forEach(t => {
    const span = document.createElement('span');
    span.className = 'tag-chip-removable';
    span.innerHTML = `#${t} <span class="rm">✕</span>`;
    span.querySelector('.rm').addEventListener('click', () => removeTagFromCurrent(t));
    el.appendChild(span);
  });
}

function addTagToCurrent(tag) {
  const memo = state.memos.find(m => m.id === currentMemoId);
  if (!memo || memo.deleted) return;
  const cleaned = tag.trim().replace(/^#/, '');
  if (!cleaned || (memo.tags || []).includes(cleaned)) return;
  memo.tags = memo.tags || [];
  memo.tags.push(cleaned);
  renderCurrentTags(memo.tags);
  renderTagFilter();
  renderMemoList();
  scheduleSave();
}

function removeTagFromCurrent(tag) {
  const memo = state.memos.find(m => m.id === currentMemoId);
  if (!memo || memo.deleted) return;
  memo.tags = (memo.tags || []).filter(t => t !== tag);
  renderCurrentTags(memo.tags);
  renderTagFilter();
  renderMemoList();
  scheduleSave();
}

// ── 드로어 제어 ──────────────────────────────────────
function openDrawer() {
  if (currentMemoId) {
    const m = state.memos.find(memo => memo.id === currentMemoId);
    if (m && !m.deleted) activeFolder = m.folder;
  }
  $('drawer').classList.add('open');
  $('drawer-overlay').classList.add('show');
  renderAll();
  setTimeout(() => $('searchInput').focus(), 300);
}

function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer-overlay').classList.remove('show');
}

function toggleDrawer() {
  if ($('drawer').classList.contains('open')) closeDrawer();
  else openDrawer();
}

// ── 에디터 특수 기능 ──────────────────────────────────
async function insertImageFromFile(file) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const fileUrl = await window.api.saveImage(e.target.result, file.name.split('.').pop() || 'png');
    $('editor').focus();
    document.execCommand('insertHTML', false, `<img src="${fileUrl}" style="max-width:100%; vertical-align:top;">`);
    updateCurrentMemo();
  };
  reader.readAsDataURL(file);
}

function applyCommand(cmd, value = null) {
  const editor = $('editor');
  
  // 에디터 포커스 및 초기 셀렉션 보장 (제목에 있더라도 에디터로 강제 이동)
  editor.focus();
  const sel = window.getSelection();

  // 에디터가 완전히 비어있다면 서식 적용을 위해 최소 구조 삽입
  if (editor.innerHTML.trim() === '' || editor.innerHTML === '<br>') {
    editor.innerHTML = '<div><br></div>';
    const range = document.createRange();
    range.selectNodeContents(editor.firstChild);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
    // 셀렉션 보정
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // 명령 실행
  document.execCommand('styleWithCSS', false, false);
  document.execCommand(cmd, false, value);
  
  // 즉시 메모 생성/업데이트 (서식이 적용된 HTML을 저장)
  if (!currentMemoId) {
    updateCurrentMemo(true);
  } else {
    updateCurrentMemo();
  }
  
  // 브라우저 내부 상태 반영을 위해 약간의 지연 후 UI 갱신
  setTimeout(updateToolbarState, 20);
}

function updateToolbarState() {
  const activeEl = document.activeElement;
  
  // 제목 입력 중일 때는 툴바를 초기 상태(보통 크기, 서식 없음)로 표시
  if (activeEl === $('editor-title')) {
    $('font-size-select').value = '3';
    document.querySelectorAll('[data-cmd]').forEach(btn => btn.classList.remove('active'));
    return;
  }

  // 검색창 등 명확히 다른 작업 중일 때는 업데이트 중단
  if (activeEl.tagName === 'INPUT' && activeEl.id !== 'editor-title' && activeEl.id !== 'searchInput' && activeEl.id !== 'tag-input') return;

  try {
    const size = document.queryCommandValue('fontSize');
    if (size) $('font-size-select').value = size;
    else if (activeEl === $('editor')) $('font-size-select').value = '3';
  } catch (e) {}
  
  document.querySelectorAll('[data-cmd]').forEach(btn => {
    try {
      const command = btn.dataset.cmd;
      const isActive = document.queryCommandState(command);
      btn.classList.toggle('active', isActive);
    } catch (e) {}
  });
}

function performEditorSearch() {
  if (CSS.highlights) { CSS.highlights.delete('search-match'); CSS.highlights.delete('search-active'); }
  const query = $('search-in-editor').value.toLowerCase();
  if (!query || !CSS.highlights) return;
  const ranges = [], editor = $('editor'), treeWalker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = treeWalker.nextNode())) {
    const text = node.nodeValue.toLowerCase();
    let start = 0, idx;
    while ((idx = text.indexOf(query, start)) !== -1) {
      const r = new Range(); r.setStart(node, idx); r.setEnd(node, idx + query.length);
      ranges.push(r); start = idx + query.length;
    }
  }
  if (ranges.length > 0) {
    CSS.highlights.set('search-match', new Highlight(...ranges));
    const activeRange = ranges[0];
    CSS.highlights.set('search-active', new Highlight(activeRange));
    activeRange.startContainer.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function closeEditorSearch() { $('in-page-search').style.display = 'none'; if (CSS.highlights) { CSS.highlights.delete('search-match'); CSS.highlights.delete('search-active'); } $('editor').focus(); }

// ── 초기화 및 통합 리스너 ─────────────────────────────
(async () => {
  // 에디터 기본 블록을 div로 설정
  document.execCommand('defaultParagraphSeparator', false, 'div');

  let settings = {};
  if (window.api?.getSettings) settings = await window.api.getSettings();
  
  applyTheme((settings.theme || localStorage.getItem('theme') || 'light') === 'light');

  const data = await window.api.loadData();
  state = data || { memos: [], folders: ['기본'], tags: [] };
  if (!Array.isArray(state.folders) || state.folders.length === 0) state.folders = ['기본'];
  else if (!state.folders.includes('기본')) state.folders.unshift('기본');
  
  state.memos = state.memos.filter(m => m && typeof m === 'object');
  state.memos.forEach(m => { if (!m.folder || !state.folders.includes(m.folder)) m.folder = '기본'; });

  renderAll(); 

  try {
    if (state.memos.length > 0) {
      let target = settings.lastMemoId ? state.memos.find(m => m.id === settings.lastMemoId && !m.deleted) : null;
      if (!target) target = state.memos.find(m => !m.deleted);
      if (target) { activeFolder = target.folder; selectMemo(target.id); } 
      else newMemo();
    } else newMemo();
  } catch (e) { newMemo(); }

  // 버튼 리스너
  $('drawerBtn').addEventListener('click', toggleDrawer);
  $('drawerCloseBtn').addEventListener('click', closeDrawer);
  $('drawer-overlay').addEventListener('click', closeDrawer);
  $('pinBtn').addEventListener('click', () => window.api.toggleAlwaysOnTop());
  $('minBtn').addEventListener('click', () => window.api.minimize());
  $('maxBtn').addEventListener('click', () => window.api.maximize());
  $('closeBtn').addEventListener('click', () => window.api.close());
  $('newBtn').addEventListener('click', () => newMemo());
  $('themeBtn').addEventListener('click', () => {
    const isLight = !document.body.classList.contains('dark');
    applyTheme(!isLight);
  });
  
  $('openExplorerBtn').addEventListener('click', () => window.api.openExplorer());
  $('export-btn').addEventListener('click', () => window.api.exportJson(state));
  $('settingsBtn').addEventListener('click', async () => {
    const d = await window.api.changeDataPath();
    if (d) { 
      state = d; activeFolder = '__all__'; currentMemoId = null; 
      clearEditor(); renderAll(); 
      if (state.memos.length > 0) selectMemo(state.memos[0].id); 
    }
  });

  $('toggleTagBtn').addEventListener('click', () => {
    const m = state.memos.find(m => m.id === currentMemoId); if (m && m.deleted) return;
    const row = $('tag-row'); row.classList.toggle('show');
    if (row.classList.contains('show')) $('tag-input').focus();
  });

  $('searchInput').addEventListener('input', (e) => { searchQuery = e.target.value; $('searchClearBtn').style.display = searchQuery ? 'block' : 'none'; renderMemoList(); });
  
  [$('editor-title'), $('editor')].forEach(el => {
    el.addEventListener('input', () => {
      if (el.id === 'editor' && el.innerText.length > 50000) { showToast('최대 50,000자까지 가능합니다.'); el.innerText = el.innerText.slice(0, 50000); }
      updateCurrentMemo();
    });
  });

  $('editor-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); const editor = $('editor'); editor.focus();
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents(editor); range.collapse(false);
      sel.removeAllRanges(); sel.addRange(range);
    }
  });

  $('editor-folder').addEventListener('change', (e) => { if (!currentMemoId) pendingCategory = e.target.value; else { updateCurrentMemo(); renderAll(); } });

  $('editor').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const sel = window.getSelection(); let node = sel.anchorNode;
      let isInList = false;
      while (node && node !== $('editor')) { if (node.nodeName === 'LI') { isInList = true; break; } node = node.parentNode; }
      if (isInList) {
        if (e.shiftKey) document.execCommand('outdent'); else document.execCommand('indent');
      } else {
        const r = sel.getRangeAt(0), t = document.createTextNode('\u00a0\u00a0');
        r.insertNode(t); r.setStartAfter(t); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
      }
      updateCurrentMemo();
    }
  });

  $('editor').addEventListener('click', (e) => { if (e.target.tagName === 'IMG') window.api.openImageViewer(e.target.src, document.body.classList.contains('dark') ? 'dark' : 'light', e.target.naturalWidth, e.target.naturalHeight); });

  $('editor').addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'IMG') {
      e.preventDefault();
      const original = Array.from($('editor').querySelectorAll('img')).find(i => i.src === e.target.src);
      if (original) {
        window.api.copyImage(original.src);
        showToast('이미지를 클립보드에 복사했습니다.');
      }
    }
  });

  $('editor').addEventListener('paste', async (e) => { 
    const htmlData = e.clipboardData.getData('text/html');
    if (htmlData && htmlData.includes('<!-- baromemo-mixed -->')) return;
    const items = e.clipboardData?.items; 
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) { e.preventDefault(); await insertImageFromFile(item.getAsFile()); return; } 
    }
  });

  $('editor').addEventListener('copy', (e) => {
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const div = document.createElement('div'); div.appendChild(sel.getRangeAt(0).cloneContents());
    const imgs = div.querySelectorAll('img');
    const rawText = sel.toString();
    const trimmedText = rawText.trim();
    
    if (imgs.length === 1 && trimmedText === '') {
      e.preventDefault();
      const original = Array.from($('editor').querySelectorAll('img')).find(i => i.src === imgs[0].src);
      if (original) { window.api.copyImage(original.src); return; }
    }

    if (imgs.length > 0 || trimmedText !== '') {
      e.preventDefault();
      let firstImagePath = null;
      imgs.forEach((img, i) => {
        const original = Array.from($('editor').querySelectorAll('img')).find(item => item.src === img.src);
        if (original) {
          if (i === 0) firstImagePath = original.src;
          
          img.removeAttribute('style');
          img.removeAttribute('class');
          img.removeAttribute('id');

          // li 안의 이미지를 독립된 줄로 만들기 위해 앞에 br 삽입 (티스토리 아래 밀림 유도)
          if (img.parentNode?.nodeName === 'LI') {
            const br = document.createElement('br');
            img.parentNode.insertBefore(br, img);
          }
          
          // 이미지 자체는 block으로 설정하여 다음 요소와 겹치지 않게 함
          img.style.display = 'block';
          img.style.maxWidth = '100%';
          img.style.marginTop = '10px';
        } else img.remove();
      });

      // 복사용 임시 DOM이므로 앱 레이아웃에 영향 주지 않음
      div.querySelectorAll('ul, ol, li').forEach(el => {
        el.style.paddingLeft = '0';
        el.style.marginLeft = '20px';
      });
      
      // li 안 앞뒤 공백 제거
      div.querySelectorAll('li').forEach(li => {
        li.innerHTML = li.innerHTML.trim();
        // 앞쪽 &nbsp; 제거
        if (li.firstChild && li.firstChild.nodeType === 3) {
          li.firstChild.textContent = li.firstChild.textContent.replace(/^\s+/, '');
        }
      });

      const htmlContent = `${div.innerHTML}<!-- baromemo-mixed -->`;

      if (window.api && window.api.copyMixed) window.api.copyMixed(htmlContent, rawText, firstImagePath);
      else { e.clipboardData.setData('text/html', htmlContent); e.clipboardData.setData('text/plain', rawText); }
    }
  });

  $('editor-title').addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.originalEvent || e).clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  
  document.querySelectorAll('[data-cmd]').forEach(btn => { btn.addEventListener('mousedown', e => e.preventDefault()); btn.addEventListener('click', () => applyCommand(btn.dataset.cmd)); });
  $('font-size-select').addEventListener('change', e => applyCommand('fontSize', e.target.value));
  $('imgBtn').addEventListener('click', () => $('imgFileInput').click());
  $('imgFileInput').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { $('editor').focus(); await insertImageFromFile(f); } e.target.value = ''; });
  
  $('deleteBtn').addEventListener('click', () => { if (currentMemoId) deleteMemo(currentMemoId); });
  $('restoreBtn').addEventListener('click', () => { if (currentMemoId) restoreMemo(currentMemoId); });
  $('permaDeleteBtn').addEventListener('click', () => { if (currentMemoId) deleteMemo(currentMemoId); });
  
  $('tag-input').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagToCurrent($('tag-input').value); $('tag-input').value = '#'; } });

  $('addCategoryBtn').addEventListener('click', () => { editingFolder = null; $('folderModal').querySelector('h3').textContent = '새 카테고리 추가'; $('folderNameInput').value = ''; showFolderError(null); $('folderModal').classList.add('show'); setTimeout(() => $('folderNameInput').focus(), 50); });
  $('folderModalCancel').addEventListener('click', () => { $('folderModal').classList.remove('show'); editingFolder = null; });
  $('folderModalOk').addEventListener('click', () => {
    const name = $('folderNameInput').value.trim(); if (!name) { $('folderModal').classList.remove('show'); return; }
    if (editingFolder) {
      if (editingFolder !== name) {
        if (state.folders.includes(name)) { showFolderError('이미 존재하는 카테고리 이름입니다.'); return; }
        state.folders = state.folders.map(f => f === editingFolder ? name : f);
        state.memos.forEach(m => { if (m.folder === editingFolder) m.folder = name; });
        if (activeFolder === editingFolder) activeFolder = name;
        scheduleSave(); renderAll();
      }
    } else {
      if (state.folders.includes(name)) { showFolderError('이미 존재하는 카테고리 이름입니다.'); return; }
      state.folders.push(name); activeFolder = name; pendingCategory = name; scheduleSave(); renderAll();
    }
    $('folderModal').classList.remove('show'); editingFolder = null;
  });

  $('folderNameInput').addEventListener('input', () => showFolderError(null));
  $('folderNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('folderModalOk').click(); if (e.key === 'Escape') $('folderModal').classList.remove('show'); });

  $('new-memo-btn').addEventListener('click', () => { if (activeFolder === '__trash__') emptyTrash(); else newMemo(); });
  $('search-in-editor').addEventListener('input', performEditorSearch);
  $('search-in-editor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); } else if (e.key === 'Escape') { e.preventDefault(); closeEditorSearch(); } });
  $('search-editor-down').addEventListener('click', () => navigateEditorSearch(true));
  $('search-editor-up').addEventListener('click', () => navigateEditorSearch(false));
  $('search-editor-close').addEventListener('click', closeEditorSearch);

  document.addEventListener('selectionchange', updateToolbarState);
  window.api.onAlwaysOnTopChanged((val) => $('pinBtn').classList.toggle('active', val));
  window.api.onMaximizedChanged((isMax) => { $('maxBtn').textContent = isMax ? '❐' : '▢'; $('maxBtn').title = isMax ? '이전 크기로' : '최대화'; });
  window.api.onNewMemo(() => newMemo('기본'));

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if ($('in-page-search').style.display === 'flex') { e.preventDefault(); closeEditorSearch(); }
      else if ($('drawer').classList.contains('open')) { e.preventDefault(); closeDrawer(); }
      else if ($('searchInput').value) { e.preventDefault(); $('searchInput').value = ''; searchQuery = ''; renderMemoList(); $('editor').focus(); }
      return;
    }
    if (!e.ctrlKey) return;
    if (key === 'n') { e.preventDefault(); newMemo(); }
    else if (key === 'l') { e.preventDefault(); toggleDrawer(); }
    else if (key === 't') { e.preventDefault(); $('toggleTagBtn').click(); }
    else if (key === 'o') { e.preventDefault(); window.api.openExplorer(); }
    else if (key === 'e') { e.preventDefault(); window.api.exportJson(state); }
    else if (key === 'p') { e.preventDefault(); window.api.toggleAlwaysOnTop(); }
    else if (key === 'm') { e.preventDefault(); }
    else if (key === 'b') { e.preventDefault(); applyCommand('bold'); }
    else if (key === 'i') { e.preventDefault(); applyCommand('italic'); }
    else if (key === 'u') { e.preventDefault(); applyCommand('underline'); }
    else if (key === 's') { e.preventDefault(); applyCommand('strikeThrough'); }
    else if (key === 'd') { e.preventDefault(); duplicateLine(); }
    else if (key === 'g') { e.preventDefault(); $('imgBtn').click(); }
    else if (key === '-' || key === '_') { e.preventDefault(); applyCommand('insertUnorderedList'); }
    else if (key === '1') { e.preventDefault(); applyCommand('insertOrderedList'); }
    else if (key === '[') {
      e.preventDefault(); const cur = parseInt($('font-size-select').value); const next = Math.max(2, cur - 1);
      applyCommand('fontSize', next.toString()); $('font-size-select').value = next.toString();
    } else if (key === ']') {
      e.preventDefault(); const cur = parseInt($('font-size-select').value); const next = Math.min(5, cur + 1);
      applyCommand('fontSize', next.toString()); $('font-size-select').value = next.toString();
    } else if (key === 'f') { e.preventDefault(); $('in-page-search').style.display = 'flex'; $('search-in-editor').focus(); $('search-in-editor').select(); if ($('search-in-editor').value) performEditorSearch(); }
    else if (key === 'arrowup' || key === 'arrowdown') {
      e.preventDefault();
      if (!currentMemoId) {
        const curIdx = state.folders.indexOf(pendingCategory || '기본');
        const nextIdx = key === 'arrowup' ? (curIdx - 1 + state.folders.length) % state.folders.length : (curIdx + 1) % state.folders.length;
        pendingCategory = state.folders[nextIdx]; $('editor-folder').value = pendingCategory;
        showToast(`카테고리 - ${pendingCategory}`); return;
      }
      const memo = state.memos.find(m => m.id === currentMemoId); if (!memo || memo.deleted) return;
      const idx = state.folders.indexOf(memo.folder);
      const nextIdx = key === 'arrowup' ? (idx - 1 + state.folders.length) % state.folders.length : (idx + 1) % state.folders.length;
      memo.folder = state.folders[nextIdx]; $('editor-folder').value = memo.folder;
      showToast(`카테고리 변경 - ${memo.folder}`); scheduleSave(); renderAll();
    } else if (key === 'z' || key === 'y') setTimeout(updateCurrentMemo, 0);
  });

  window.addEventListener('focus', () => {
    if (currentMemoId && !$('drawer').classList.contains('open')) {
      const editor = $('editor');
      if (document.activeElement !== editor && document.activeElement !== $('editor-title') && document.activeElement !== $('searchInput')) {
        editor.focus(); const sel = window.getSelection(), range = document.createRange();
        range.selectNodeContents(editor); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
      }
    }
  });
})();

function applyTheme(light) {
  document.body.classList.toggle('dark', !light);
  $('themeBtn').textContent = light ? '🌙' : '☀';
  localStorage.setItem('theme', light ? 'light' : 'dark');
  if (window.api?.setTheme) window.api.setTheme(light ? 'light' : 'dark');
}

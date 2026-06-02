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

  // 플레이스홀더 상태 설정
  if (editor.innerHTML === '<div><br></div>' || editor.innerHTML === '' || editor.innerHTML === '<br>') {
    editor.setAttribute('data-empty', 'true');
  } else {
    editor.removeAttribute('data-empty');
  }

  // 기존 링크들에서 title 속성 제거 (커스텀 툴팁과 겹침 방지)
  if (typeof fixExistingLinks === 'function') fixExistingLinks(editor);
  
  const sel = $('editor-folder');
  if (sel) sel.value = memo.folder;
  
  if (!memo.deleted) lastValidMemoId = id;
  if (window.api?.saveLastMemo) window.api.saveLastMemo(id);
  
  const isTrash = !!memo.deleted;
  if ($('formatting-tools')) $('formatting-tools').style.display = isTrash ? 'none' : 'flex';
  $('trash-btns').style.display = isTrash ? 'flex' : 'none';
  $('trash-btns').style.marginLeft = 'auto'; // 우측 정렬 유지
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
  editor.innerHTML = '<div><br></div>'; // 초기 블록 구조 강제 생성
  editor.setAttribute('data-empty', 'true');
  editor.contentEditable = true;
  
  // 에디터 서식 상태 초기화
  editor.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor.firstChild);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  
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
  $('status-text').textContent = (memo.deleted ? '삭제일: ' : '') + fmt(time);
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
    document.execCommand('insertParagraph');
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

function linkifyEditor() {
  const editor = $('editor');
  
  // 1. 방해 노드 제거 및 정규화
  const comments = [];
  const commentWalk = document.createTreeWalker(editor, NodeFilter.SHOW_COMMENT, null, false);
  let c;
  while (c = commentWalk.nextNode()) comments.push(c);
  comments.forEach(c => c.remove());
  editor.normalize();

  const sel = window.getSelection();
  let savedRange = null;
  if (sel.rangeCount > 0) {
    try { savedRange = sel.getRangeAt(0).cloneRange(); } catch(e) {}
  }

  // 2. 모든 텍스트 노드 수집 (재귀적)
  const textNodes = [];
  function collectTextNodes(node) {
    if (node.nodeType === 3) {
      // 텍스트 노드 수집
      textNodes.push(node);
    } else if (node.nodeType === 1) {
      // .memo-link span 자체는 건너뜀 (내용물만 처리)
      for (let child of node.childNodes) collectTextNodes(child);
    }
  }
  collectTextNodes(editor);

  const urlPattern = /https?:\/\/[^\s\u00a0]+/gi;

  // 3. 변환 및 정리 실행
  textNodes.forEach(node => {
    const parent = node.parentNode;
    if (!parent) return;

    // 이미 링크인 경우: 텍스트가 URL과 일치하지 않으면 unwrap
    if (parent.tagName === 'SPAN' && parent.classList.contains('memo-link')) {
      const linkText = parent.textContent;
      if (!linkText.match(/^https?:\/\/[^\s\u00a0]+$/i)) {
        const fragment = document.createDocumentFragment();
        while (parent.firstChild) fragment.appendChild(parent.firstChild);
        parent.parentNode.replaceChild(fragment, parent);
      }
      return;
    }

    // 링크가 아닌 경우: URL 검색 및 변환
    const text = node.textContent;
    let match;
    const fragments = [];
    let lastIdx = 0;
    urlPattern.lastIndex = 0; // 정규식 상태 초기화

    while ((match = urlPattern.exec(text)) !== null) {
      if (match.index > lastIdx) {
        fragments.push(document.createTextNode(text.substring(lastIdx, match.index)));
      }
      const span = document.createElement('span');
      span.className = 'memo-link';
      span.dataset.href = match[0];
      span.textContent = match[0];
      fragments.push(span);
      lastIdx = urlPattern.lastIndex;
    }

    if (fragments.length > 0) {
      if (lastIdx < text.length) {
        fragments.push(document.createTextNode(text.substring(lastIdx)));
      }
      fragments.forEach(f => parent.insertBefore(f, node));
      parent.removeChild(node);
    }
  });

  if (savedRange) {
    try {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } catch (e) {}
  }
}

function closeEditorSearch() { $('in-page-search').style.display = 'none'; if (CSS.highlights) { CSS.highlights.delete('search-match'); CSS.highlights.delete('search-active'); } $('editor').focus(); }

function duplicateLine() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const editor = $('editor');
  
  let node = sel.anchorNode;
  if (!editor.contains(node)) return;
  
  // 현재 커서가 위치한 블록(DIV, LI 등) 찾기
  let block = node;
  if (block.nodeType === 3) block = block.parentNode;
  while (block && block !== editor && !['DIV', 'P', 'LI'].includes(block.nodeName)) {
    block = block.parentNode;
  }
  
  if (block && block !== editor) {
    // 1. 현재 블록의 HTML 가져오기
    const html = block.outerHTML;
    
    // 2. 커서를 현재 블록 바로 뒤로 이동
    const newRange = document.createRange();
    newRange.setStartAfter(block);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    
    // 3. execCommand를 사용하여 HTML 삽입 (Undo 스택 유지)
    document.execCommand('insertHTML', false, html);
    
    // 4. 삽입된 블록의 끝으로 커서 이동
    const afterBlock = block.nextSibling;
    if (afterBlock) {
      const finalRange = document.createRange();
      finalRange.selectNodeContents(afterBlock);
      finalRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(finalRange);
    }
    
    updateCurrentMemo();
  }
}

// ── 초기화 및 통합 리스너 ─────────────────────────────
(async () => {
  // 에디터 기본 블록을 div로 설정
  document.execCommand('defaultParagraphSeparator', false, 'div');

  let settings = {};
  if (window.api?.getSettings) settings = await window.api.getSettings();
  
  applyTheme((settings.theme || localStorage.getItem('theme') || 'light') === 'light');

  const data = await window.api.loadData();
  state = data || { memos: [], folders: ['기본'], tags: [] };
  
  // 전역 마이그레이션: 모든 메모의 링크에서 title 속성 제거
  if (state.memos) {
    state.memos.forEach(m => {
      if (m.content) m.content = m.content.replace(/ title="Ctrl \+ 클릭하여 링크 열기"/g, '');
    });
  }

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
      if (el.id === 'editor') {
        if (el.innerText.length > 50000) { 
          showToast('최대 50,000자까지 가능합니다.'); 
          el.innerText = el.innerText.slice(0, 50000); 
          // 커서를 맨 뒤로 이동
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        
        // 플레이스홀더 상태 토글
        if (el.innerHTML === '<div><br></div>' || el.innerHTML === '' || el.innerHTML === '<br>') {
          el.setAttribute('data-empty', 'true');
        } else {
          el.removeAttribute('data-empty');
        }

        // 링크 실시간 자동 변환(linkifyEditor) 비활성화 (1안 적용)
        // clearTimeout(el.linkifyTimer);
        // el.linkifyTimer = setTimeout(linkifyEditor, 200);
      }
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
    if (e.repeat) return;

    if (e.key === 'Backspace') {
      const editor = $('editor');
      // 에디터가 초기 구조(<div><br></div>)만 남은 상태에서 백스페이스 시 삭제 차단
      if (editor.innerHTML === '<div><br></div>') {
        e.preventDefault();
        return;
      }

      const sel = window.getSelection();
      if (sel.rangeCount > 0 && sel.getRangeAt(0).collapsed) {
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType === 3 && range.startOffset <= 1) {
          const prev = node.previousSibling;
          const parent = node.parentNode;
          const parentPrev = parent?.previousSibling;
          
          // 1. 바로 앞 형제들 탐색 (공백이나 ZWSP만 있는 텍스트 노드는 계속 건너뜀)
          let linkNode = null;
          let temp = prev;
          
          while (temp && temp.nodeType === 3) {
             if (/^[\s\u200B]*$/.test(temp.textContent)) {
                 temp = temp.previousSibling;
             } else {
                 break;
             }
          }
          
          if (temp && temp.nodeType === 1 && temp.classList.contains('memo-link')) {
             linkNode = temp;
          }
          
          // 2. 부모 자체가 링크인 경우 (텍스트 노드가 링크 span 내부에 갇힌 경우)
          if (!linkNode && parent && parent.nodeType === 1 && parent.classList.contains('memo-link')) {
            linkNode = parent;
          }
          
          // 3. 부모의 바로 앞 형제가 링크인 경우
          if (!linkNode && parentPrev && parentPrev.nodeType === 1 && parentPrev.classList.contains('memo-link')) {
            linkNode = parentPrev;
          }

          if (linkNode) {
            if (/^[\s\u200B]*$/.test(node.textContent) || node.textContent.startsWith(' ')) {
              e.preventDefault();
              
              node.textContent = node.textContent.replace(/^[\s\u200B]/, '');
              
              // 중간에 낀 불필요한 빈 텍스트 노드들 정리
              let curr = prev;
              while (curr && curr !== linkNode) {
                  let nextCurr = curr.previousSibling;
                  if (curr.nodeType === 3 && /^[\s\u200B]*$/.test(curr.textContent)) {
                      curr.parentNode.removeChild(curr);
                  }
                  curr = nextCurr;
              }

              const newRange = document.createRange();
              newRange.selectNodeContents(linkNode);
              newRange.collapse(false);
              sel.removeAllRanges();
              sel.addRange(newRange);
              updateCurrentMemo();
              return;
            }
          }
        }
      }
    }

    if (e.key === 'Enter' || e.key === ' ') {
      const sel = window.getSelection();
      if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);

        // 1. 주소 입력 완료 시 자동 링크 변환 (감지 로직을 최우선으로 배치)
        const node = range.startContainer;
        
        let isInsideLink = false;
        let checkNode = node;
        while (checkNode && checkNode !== $('editor')) {
          if (checkNode.classList && checkNode.classList.contains('memo-link')) { isInsideLink = true; break; }
          checkNode = checkNode.parentNode;
        }

        if (!isInsideLink && node.nodeType === 3) {
          const originalFullText = node.textContent;
          
          // 커서 위치까지의 텍스트 추출 (원본 텍스트 기준)
          const textBeforeCaret = originalFullText.substring(0, range.startOffset);
          
          // \u00a0(NBSP)와 일반 공백 모두를 기준으로 단어 분리
          const words = textBeforeCaret.split(/[\s\u00a0]/);
          const lastWord = words[words.length - 1];
          
          // URL 패턴 (공백 및 NBSP 제외)
          const urlPattern = /^(https?:\/\/[^\s\u00a0]+)$/i;

          if (lastWord && urlPattern.test(lastWord)) {
            e.preventDefault(); // 브라우저 기본 동작 차단

            // 원본 텍스트 기준으로 정확한 시작 지점 계산
            const startOffset = range.startOffset - lastWord.length;
            const linkText = lastWord;
            // %20 등 인코딩된 공백 및 후행 공백(\s, \u00a0) 제거 버전 생성
            const cleanLinkText = decodeURIComponent(linkText).replace(/[\s\u00a0]+$/, '');
            
            // 원본 텍스트(originalFullText)를 기준으로 prefix와 suffix 계산
            const prefix = originalFullText.substring(0, startOffset);
            const suffix = originalFullText.substring(range.startOffset);
            
            // 기존 노드에 URL 이전 텍스트(prefix)만 남김
            node.textContent = prefix;
            
            const span = document.createElement('span');
            span.className = 'memo-link'; 
            span.setAttribute('data-href', cleanLinkText); 
            span.textContent = cleanLinkText;
            
            // 링크 뒤에 배치할 노드: 공백(또는 탈출용 공백) + 기존 suffix 결합
            const afterText = (e.key === ' ' ? ' ' : '\u00a0') + suffix;
            const afterNode = document.createTextNode(afterText);
            
            const parent = node.parentNode;
            parent.insertBefore(span, node.nextSibling); 
            parent.insertBefore(afterNode, span.nextSibling);
            
            const newRange = document.createRange();
            if (e.key === ' ') {
              // 1. afterNode(공백) 뒤로 이동
              newRange.setStart(afterNode, 1);
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);

              // 2. styleWithCSS 실행 (서식 처리 방식 설정)
              document.execCommand('styleWithCSS', false, false);

              // 3. 빈 텍스트 노드(ZWSP)를 하나 더 추가하여 span 영향권 완전히 탈출
              const extraNode = document.createTextNode('\u200B');
              parent.insertBefore(extraNode, afterNode.nextSibling);
              
              newRange.setStart(extraNode, 1);
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);

              // 4. 개별 서식 상태 강제 해제
              ['bold', 'italic', 'underline', 'strikeThrough'].forEach(cmd => {
                if (document.queryCommandState(cmd)) document.execCommand(cmd, false, null);
              });
            } else {
              // 엔터 입력 시: 리스트(li) 내부인지 확인
              let isInLi = false;
              let tempNode = afterNode.parentNode;
              const editor = $('editor');
              while (tempNode && tempNode !== editor) {
                if (tempNode.nodeName === 'LI') { isInLi = true; break; }
                tempNode = tempNode.parentNode;
              }

              if (isInLi) {
                // li 내부인 경우 브라우저 기본 줄바꿈(새 li 생성)을 따름
                newRange.setStart(afterNode, 0);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
                document.execCommand('insertParagraph');
                
                // 줄바꿈 후 커서 뒤에 남은 불필요한 공백(\u00a0) 제거
                const postSel = window.getSelection();
                if (postSel.rangeCount > 0) {
                  const postRange = postSel.getRangeAt(0);
                  const postNode = postRange.startContainer;
                  if (postNode.nodeType === 3 && postNode.textContent.startsWith('\u00a0')) {
                    postNode.textContent = postNode.textContent.substring(1);
                  }
                }
                // 기존 afterNode에서도 공백 제거
                if (afterNode.textContent.startsWith('\u00a0')) {
                  afterNode.textContent = afterNode.textContent.substring(1);
                }
              } else {
                // 일반 줄인 경우: suffix를 포함한 새 줄(div)을 직접 생성하여 삽입
                const newDiv = document.createElement('div');
                if (suffix) {
                  newDiv.textContent = suffix;
                } else {
                  newDiv.innerHTML = '<br>';
                }
                
                afterNode.textContent = '';
                
                let block = afterNode;
                while (block && block.parentNode !== editor && block !== editor) {
                  block = block.parentNode;
                }
                
                if (block && block !== editor) {
                  block.parentNode.insertBefore(newDiv, block.nextSibling);
                } else {
                  parent.insertBefore(newDiv, afterNode.nextSibling);
                }

                const targetRange = document.createRange();
                targetRange.setStart(newDiv, 0);
                targetRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(targetRange);
              }
            }
            updateCurrentMemo();
            return; // 핸들러 종료
          }
        }

        // 2. 이미 존재하는 링크 탈출 처리 (자동 변환 대상이 아닐 때만 실행)
        let temp = range.startContainer;
        let link = null;
        while (temp && temp.id !== 'editor') {
          if (temp.classList && temp.classList.contains('memo-link')) { link = temp; break; }
          temp = temp.parentNode;
        }
        
        if (link) {
          if (e.key === 'Enter') {
            e.preventDefault();
            const afterNode = document.createTextNode('\u00a0');
            link.parentNode.insertBefore(afterNode, link.nextSibling);
            const newRange = document.createRange();
            newRange.setStart(afterNode, 0);
            newRange.collapse(true);
            sel.removeAllRanges(); sel.addRange(newRange);
            
            // 서식 초기화 제거 후 줄바꿈만 수행 (사용자 요청)
            document.execCommand('insertParagraph');
            if (afterNode.textContent === '\u00a0') afterNode.textContent = '';
          } else if (e.key === ' ') {
            e.preventDefault();
            const afterNode = document.createTextNode(' '); 
            link.parentNode.insertBefore(afterNode, link.nextSibling);

            // 1. afterNode(공백) 뒤로 이동
            const newRange = document.createRange();
            newRange.setStart(afterNode, 1);
            newRange.collapse(true);
            sel.removeAllRanges(); sel.addRange(newRange);
            
            // 2. styleWithCSS 실행
            document.execCommand('styleWithCSS', false, false);

            // 3. 빈 텍스트 노드(ZWSP)를 하나 더 추가하여 span 영향권 완전히 탈출
            const extraNode = document.createTextNode('\u200B');
            link.parentNode.insertBefore(extraNode, afterNode.nextSibling);
            
            newRange.setStart(extraNode, 1);
            newRange.collapse(true);
            sel.removeAllRanges(); sel.addRange(newRange);

            // 4. 개별 서식 상태 강제 해제
            ['bold', 'italic', 'underline', 'strikeThrough'].forEach(cmd => {
              if (document.queryCommandState(cmd)) document.execCommand(cmd, false, null);
            });
          }
          updateCurrentMemo();
          return;
        }
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const sel = window.getSelection(); if (!sel.rangeCount) return;
      const editor = $('editor');
      const range = sel.getRangeAt(0);
      const anchorNode = sel.anchorNode;
      const anchorOffset = sel.anchorOffset;
      
      // 현재 커서가 속한 블록(DIV, LI 등) 찾기
      let block = anchorNode;
      if (block && block.nodeType === 3) block = block.parentNode;
      while (block && block !== editor && !['DIV', 'P', 'LI'].includes(block.nodeName)) {
        block = block.parentNode;
      }
      
      // 만약 블록을 못 찾았다면 (에디터 직속 텍스트 노드인 경우), anchorNode 자체가 블록 역할을 하도록 함
      let targetBlock = (block && block !== editor) ? block : null;
      let isDirectText = false;
      if (!targetBlock && anchorNode && editor.contains(anchorNode)) {
          if (anchorNode.nodeType === 3) {
              targetBlock = anchorNode;
              isDirectText = true;
          }
      }

      let isInList = false;
      let temp = anchorNode;
      while (temp && temp !== editor) { if (temp.nodeName === 'LI') { isInList = true; break; } temp = temp.parentNode; }
      
      if (e.shiftKey) {
        if (isInList) {
          document.execCommand('outdent');
        } else if (targetBlock) {
          const targetNode = isDirectText ? targetBlock : targetBlock.firstChild;
          if (targetNode && targetNode.nodeType === 3) {
            const text = targetNode.textContent;
            let removedCount = 0;
            if (text.startsWith('\u00a0\u00a0')) removedCount = 2;
            else if (text.startsWith('\u00a0') || text.startsWith(' ')) removedCount = 1;
            
            if (removedCount > 0) {
              targetNode.textContent = text.substring(removedCount);
              // 커서 위치 복구 (내어쓰기만큼 앞으로 이동하여 제자리 유지)
              const newRange = document.createRange();
              let newOffset = anchorOffset;
              if (anchorNode === targetNode) newOffset = Math.max(0, anchorOffset - removedCount);
              newRange.setStart(anchorNode, newOffset);
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);
            }
          }
        }
      } else {
        if (isInList) {
          // depth 체크: 2depth(UL/OL이 2개 중첩)까지만 허용
          let depth = 0;
          let curr = temp;
          while (curr && curr !== editor) {
            if (curr.nodeName === 'UL' || curr.nodeName === 'OL') depth++;
            curr = curr.parentNode;
          }
          if (depth < 2) document.execCommand('indent');
        } else if (targetBlock) {
          const targetNode = isDirectText ? targetBlock : targetBlock.firstChild;
          if (targetNode && targetNode.nodeType === 3) {
            targetNode.textContent = '\u00a0\u00a0' + targetNode.textContent;
            
            // 커서 위치 복구 (들여쓰기만큼 뒤로 이동하여 제자리 유지)
            const newRange = document.createRange();
            let newOffset = anchorOffset;
            if (anchorNode === targetNode) newOffset = anchorOffset + 2;
            newRange.setStart(anchorNode, newOffset);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
          } else if (!isDirectText) {
            const newText = document.createTextNode('\u00a0\u00a0');
            targetBlock.insertBefore(newText, targetBlock.firstChild);
            
            const newRange = document.createRange();
            // 입력 포커스 제자리 유지 (빈 줄인 경우에만 공백 뒤로, 아니면 원래 위치 유지)
            if (targetBlock.innerText.trim() === '' || targetBlock.innerHTML === '<br>') {
              newRange.setStart(newText, 2);
            } else {
              newRange.setStart(anchorNode, anchorOffset);
            }
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
          } else {
              document.execCommand('insertText', false, '\u00a0\u00a0');
          }
        } else {
          document.execCommand('insertText', false, '\u00a0\u00a0');
        }
      }
      updateCurrentMemo();
    }
  });

  // 툴팁 제어 로직
  $('editor').addEventListener('mousemove', (e) => {
    const editor = $('editor');
    const scrollbarWidth = editor.offsetWidth - editor.clientWidth;
    if (e.clientX > editor.getBoundingClientRect().right - scrollbarWidth) {
      editor.style.cursor = 'default';
    } else {
      editor.style.cursor = '';
    }

    const tooltip = $('link-tooltip');
    const link = e.target.closest('.memo-link');
    
    if (link) {
      tooltip.style.display = 'block';
      tooltip.style.opacity = '1';
      
      const gap = 15;
      let left = e.clientX + gap;
      let top = e.clientY + gap;
      
      // 화면 경계 감지 (툴팁이 창 밖으로 나가지 않게 조정)
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      
      if (left + tooltipWidth > windowWidth) {
        left = e.clientX - tooltipWidth - gap;
      }
      if (top + tooltipHeight > windowHeight) {
        top = e.clientY - tooltipHeight - gap;
      }
      
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    } else {
      tooltip.style.opacity = '0';
      setTimeout(() => { if (tooltip.style.opacity === '0') tooltip.style.display = 'none'; }, 100);
    }
  });

  $('editor').addEventListener('mouseleave', () => {
    const tooltip = $('link-tooltip');
    tooltip.style.opacity = '0';
    tooltip.style.display = 'none';
  });

  $('editor').addEventListener('mousedown', (e) => {
    // 스팬 링크 클릭 시 커서 위치 지정
    if (e.target.classList.contains('memo-link') && !e.ctrlKey) {
      const sel = window.getSelection();
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  });

  $('editor').addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') window.api.openImageViewer(e.target.src, document.body.classList.contains('dark') ? 'dark' : 'light', e.target.naturalWidth, e.target.naturalHeight);
    const link = e.target.closest('.memo-link');
    if (link && e.ctrlKey) {
      e.preventDefault();
      const href = link.getAttribute('data-href');
      if (href) window.api.openExternal(href);
    }
  });

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
    const htmlData = e.clipboardData.getData('text/html'), textData = e.clipboardData.getData('text/plain');
    const items = e.clipboardData?.items; 
    if (items) { for (const item of items) { if (item.type.startsWith('image/')) { e.preventDefault(); await insertImageFromFile(item.getAsFile()); return; } } }
    
    if (textData && !htmlData) {
      const urlPattern = /^(https?:\/\/[^\s]+)$/i;
      const trimmed = textData.trim();
      if (urlPattern.test(trimmed)) {
        e.preventDefault();
        
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        
        const range = sel.getRangeAt(0);
        range.deleteContents();
        
        // [Refined Fix] 에디터가 완전히 비어있거나 초기 블록만 있는 경우 강제 초기화
        const editor = $('editor');
        const isEmptyEditor = editor.innerHTML === '<div><br></div>' || editor.innerHTML === '<br>' || editor.innerHTML === '';
        
        if (isEmptyEditor) {
          editor.innerHTML = '';
          editor.removeAttribute('data-empty'); // 붙여넣기 즉시 플레이스홀더 제거
          // 에디터를 비웠으므로 range를 다시 잡음
          range.setStart(editor, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          // 일반적인 빈 블록(LI 등) 처리 로직 유지
          let block = range.startContainer;
          if (block.nodeType === 3) block = block.parentNode;
          while (block && block !== editor && !['DIV','P','LI'].includes(block.nodeName)) {
            block = block.parentNode;
          }
          if (block && block !== editor && (block.innerHTML === '<br>' || block.innerHTML === '')) {
            block.innerHTML = '';
            range.setStart(block, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        
        // 1. 링크 스팬 및 방화벽(ZWSP)을 HTML로 구성하여 삽입 (Undo 스택 지원)
        const html = `<span class="memo-link" data-href="${trimmed}">${trimmed}</span>\u200B`;
        document.execCommand('insertHTML', false, html);
        
        // 2. removeFormat 실행하여 서식 단절 (커서는 이미 ZWSP 뒤에 위치함)
        document.execCommand('removeFormat', false, null);

        setTimeout(updateCurrentMemo, 10);
        return;
      }
    }

    // 일반 텍스트나 HTML 붙여넣기 시에만 전체 변환 로직 실행
    setTimeout(() => {
      linkifyEditor();
      
      const editor = $('editor');
      if (editor.children.length > 1) {
        const first = editor.firstElementChild;
        if (first && first.tagName === 'DIV' && (first.innerHTML === '<br>' || first.innerHTML === '')) {
          first.remove();
        }
      }

      updateCurrentMemo();
    }, 100);
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
    else if (key === '-') { e.preventDefault(); applyCommand('insertUnorderedList'); }
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

  window.addEventListener('keydown', (e) => { if (e.key === 'Control') $('editor').setAttribute('data-ctrl', 'true'); });
  window.addEventListener('keyup', (e) => { if (e.key === 'Control') $('editor').removeAttribute('data-ctrl'); });

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

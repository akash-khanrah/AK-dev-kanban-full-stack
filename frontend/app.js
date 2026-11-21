const API_BASE = "/api";
let currentUser = null;
let tasks = [];
let draggedTaskId = null;
let ws = null;

const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function showAuthMessage(msg, type = "error") {
  const box = el("authMessage");
  box.textContent = msg;
  box.className = `auth-msg ${type}`;
}

function clearAuthMessage() {
  el("authMessage").className = "auth-msg hidden";
}

el("tabLogin").addEventListener("click", () => {
  el("tabLogin").classList.add("active");
  el("tabRegister").classList.remove("active");
  el("loginForm").classList.remove("hidden");
  el("registerForm").classList.add("hidden");
  clearAuthMessage();
});

el("tabRegister").addEventListener("click", () => {
  el("tabRegister").classList.add("active");
  el("tabLogin").classList.remove("active");
  el("registerForm").classList.remove("hidden");
  el("loginForm").classList.add("hidden");
  clearAuthMessage();
});

el("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthMessage();

  const formData = new FormData();
  formData.append("full_name", el("regName").value.trim());
  formData.append("email", el("regEmail").value.trim());
  formData.append("password", el("regPassword").value);
  formData.append("mobile_number", el("regMobile").value.trim());
  formData.append("job_role", el("regRole").value.trim());
  formData.append("gender", el("regGender").value);
  formData.append("dob", el("regDob").value);
  formData.append("interview_mode", el("regInterview").value);
  formData.append("role", el("regCategory").value);

  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    showAuthMessage(data.detail || "Registration failed.", "error");
    el("authMessage").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  el("registerForm").reset();
  el("tabLogin").click();
  showAuthMessage(
    "Successfully Registered! Please wait for Admin approval to login.",
    "success"
  );
  el("authMessage").scrollIntoView({ behavior: "smooth", block: "center" });
});

el("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthMessage();

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: el("loginIdentifier").value.trim(),
      password: el("loginPassword").value,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    showAuthMessage(data.detail || "Login failed.", "error");
    return;
  }

  enterApp(data);
});

function enterApp(user) {
  currentUser = user;
  localStorage.setItem("devsync_user", JSON.stringify(user));

  el("authScreen").classList.add("hidden");
  el("appScreen").classList.remove("hidden");

  el("liveUserName").textContent = user.full_name;
  el("liveUserRole").textContent = user.role;

  if (user.role === "admin") {
    showView("admin");
  } else {
    showView("board");
  }

  fetchTasks();
  fetchActivity();
  connectWebSocket();
}

function logoutUser(reason = "") {
  currentUser = null;
  localStorage.removeItem("devsync_user");
  if (ws) {
    ws.close();
    ws = null;
  }
  el("appScreen").classList.add("hidden");
  el("authScreen").classList.remove("hidden");
  if (reason) {
    showAuthMessage(reason, "error");
  } else {
    clearAuthMessage();
  }
}

el("logoutBtn").addEventListener("click", () => logoutUser());

function showView(view) {
  el("boardView").classList.add("hidden");
  el("adminView").classList.add("hidden");

  if (view === "board") {
    el("boardView").classList.remove("hidden");
    if (currentUser && currentUser.role === "admin") {
      el("backToAdminBtn").classList.remove("hidden");
    } else {
      el("backToAdminBtn").classList.add("hidden");
    }
  } else if (view === "admin") {
    el("adminView").classList.remove("hidden");
    el("backToAdminBtn").classList.add("hidden");
    loadAdminEmployees();
  }
}

el("adminBackBtn").addEventListener("click", () => showView("board"));
el("backToAdminBtn").addEventListener("click", () => showView("admin"));

let adminEmployees = [];
let selectedRegEmpId = null;

async function loadAdminEmployees() {
  const res = await fetch(`${API_BASE}/admin/employees`);
  adminEmployees = await res.json();

  const nonAdmin = adminEmployees.filter((e) => e.role !== "admin");
  const pending = nonAdmin.filter((e) => e.status === "pending");
  const approved = nonAdmin.filter((e) => e.status === "approved");
  const deleted = nonAdmin.filter((e) => e.status === "deleted");

  el("countPending").textContent = pending.length;
  el("countCurrent").textContent = approved.length;
  el("countDeleted").textContent = deleted.length;

  renderAdminColumn("colPending", pending, "pending");
  renderAdminColumn("colCurrent", approved, "approved");
  renderAdminColumn("colDeleted", deleted, "deleted");
  renderOnlineStatusColumn(adminEmployees.filter((e) => e.status == "approved"));
}

function renderOnlineStatusColumn(approvedList) {
  const col = el("colOnlineStatus");
  if (!col) return;
  el("countOnlineStatus").textContent = approvedList.length;
  col.innerHTML = "";
  if (approvedList.length === 0) {
    col.innerHTML = `<div style="text-align:center;color:#6b7280;font-size:13px;padding:16px;">No employees</div>`;
    return;
  }
  const sorted = [...approvedList].sort((a, b) => {
    const aOnline = onlineUserIds.has(a.id) ? 1 : 0;
    const bOnline = onlineUserIds.has(b.id) ? 1 : 0;
    return bOnline - aOnline;
  });  
  sorted.forEach((emp) => {
    const isOnline = onlineUserIds.has(emp.id);
    const dotClass = isOnline ? "online" : "offline";
    const row = document.createElement("div");
    row.className = "card";
    row.style.cursor = "default";
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.innerHTML = `
      <span class="card-title" style="margin:0;">${escapeHtml(emp.full_name)}</span>
      <span class="status-dot ${dotClass}" title="${isOnline ? "Online" : "Offline"}"></span>
    `;
    col.appendChild(row);
  });
}

function renderAdminColumn(colId, list, type) {
  const col = el(colId);
  col.innerHTML = "";

  if (list.length === 0) {
    col.innerHTML = `<div style="text-align:center;color:#6b7280;font-size:13px;padding:16px;">No employees</div>`;
    return;
  }

  list.forEach((emp) => {
    const regTime = emp.created_at ? new Date(emp.created_at).toLocaleString() : "—";
    const seenTime = emp.last_seen_at ? new Date(emp.last_seen_at).toLocaleString() : "—";
    const card = document.createElement("div");
    card.className = "card";
    card.style.cursor = "default";

    let actionsHtml = "";
    if (type === "pending") {
      actionsHtml = `
        <button class="btn-success" onclick="approveEmp(${emp.id})">Accept</button>
        <button class="btn-danger" style="padding:5px 10px;font-size:12px;" onclick="deleteEmp(${emp.id})">Delete</button>
      `;
    } else if (type === "approved") {
      actionsHtml = `
        <button class="btn-secondary" style="padding:4px 9px;font-size:12px;" onclick="openEditEmpModal(${emp.id})">Edit</button>
        <button class="btn-danger" style="padding:4px 9px;font-size:12px;" onclick="deleteEmp(${emp.id})">Delete</button>
      `;
    } else {
      actionsHtml = `
        <button class="btn-success" onclick="restoreEmp(${emp.id})">Restore</button>
        <span class="priority-badge priority-urgent">Deleted</span>
      `;
    }

    const titleHtml =
      type === "pending"
        ? `<span class="clickable-name" onclick="openRegDetails(${emp.id})">${escapeHtml(emp.full_name)}</span>`
        : escapeHtml(emp.full_name);

    card.innerHTML = `
      <div class="card-top">
        <span class="tag">${escapeHtml(emp.job_role)}</span>
        <div style="display:flex;gap:4px;">${actionsHtml}</div>
      </div>
      <div class="card-title">${titleHtml}</div>
      <div class="card-desc">${escapeHtml(emp.email)} &bull; ${escapeHtml(emp.mobile_number)}</div>
      <div class="card-footer">
        <span>Reg: ${regTime}</span>
      </div>
      <div class="card-footer" style="margin-top:2px;">
        <span>Seen: ${seenTime}</span>
      </div>
    `;
    col.appendChild(card);
  });
}

window.openRegDetails = function (id) {
  const emp = adminEmployees.find((e) => e.id === id);
  if (!emp) return;
  selectedRegEmpId = id;
  const regTime = emp.created_at ? new Date(emp.created_at).toLocaleString() : "—";
  el("regDetailsBody").innerHTML = `
    <div><strong>Full Name:</strong><br/>${escapeHtml(emp.full_name)}</div>
    <div><strong>Email:</strong><br/>${escapeHtml(emp.email)}</div>
    <div><strong>Mobile:</strong><br/>${escapeHtml(emp.mobile_number)}</div>
    <div><strong>Job Role:</strong><br/>${escapeHtml(emp.job_role)}</div>
    <div><strong>Gender:</strong><br/>${escapeHtml(emp.gender)}</div>
    <div><strong>Date of Birth:</strong><br/>${escapeHtml(emp.dob)}</div>
    <div><strong>Interview Option:</strong><br/>${escapeHtml(emp.interview_mode)}</div>
    <div><strong>Registered At:</strong><br/>${regTime}</div>
  `;
  el("regDetailsModal").classList.remove("hidden");
};

function closeRegDetails() {
  el("regDetailsModal").classList.add("hidden");
  selectedRegEmpId = null;
}

el("closeRegDetailsBtn").addEventListener("click", closeRegDetails);
el("modalCloseRegBtn").addEventListener("click", closeRegDetails);
el("modalAcceptBtn").addEventListener("click", async () => {
  if (selectedRegEmpId) {
    await approveEmp(selectedRegEmpId);
    closeRegDetails();
  }
});
el("modalDeleteBtn").addEventListener("click", async () => {
  if (selectedRegEmpId) {
    await deleteEmp(selectedRegEmpId, true);
    closeRegDetails();
  }
});

window.openEditEmpModal = function (id) {
  const emp = adminEmployees.find((e) => e.id === id);
  if (!emp) return;
  el("editEmpId").value = emp.id;
  el("editEmpName").value = emp.full_name;
  el("editEmpEmail").value = emp.email;
  el("editEmpMobile").value = emp.mobile_number;
  el("editEmpRole").value = emp.job_role;
  el("editEmpGender").value = emp.gender;
  el("editEmpInterview").value = emp.interview_mode;
  el("editEmpCategory").value = emp.role || "employee";
  el("editEmpModal").classList.remove("hidden");
};

function closeEditEmpModal() {
  el("editEmpModal").classList.add("hidden");
}

el("closeEditEmpBtn").addEventListener("click", closeEditEmpModal);
el("cancelEditEmpBtn").addEventListener("click", closeEditEmpModal);

el("editEmpForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = el("editEmpId").value;
  await fetch(`${API_BASE}/admin/employees/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_name: el("editEmpName").value.trim(),
      email: el("editEmpEmail").value.trim(),
      mobile_number: el("editEmpMobile").value.trim(),
      job_role: el("editEmpRole").value.trim(),
      gender: el("editEmpGender").value,
      interview_mode: el("editEmpInterview").value,
      role: el("editEmpCategory").value,
    }),
  });
  closeEditEmpModal();
  loadAdminEmployees();
});

window.approveEmp = async function (id) {
  await fetch(`${API_BASE}/admin/employees/${id}/approve`, { method: "POST" });
  loadAdminEmployees();
};

window.restoreEmp = async function (id) {
  await fetch(`${API_BASE}/admin/employees/${id}/restore`, { method: "POST" });
  loadAdminEmployees();
};

window.permanentDeleteEmp = async function (id) {
  if (!confirm("Permanently delete this employee from the database?")) return;
  await fetch(`${API_BASE}/admin/employees/${id}/permanent`, { method: "DELETE" });
  loadAdminEmployees();
};

window.deleteEmp = async function (id, skipConfirm = false) {
  if (!skipConfirm && !confirm("Delete this employee? They will be moved to Deleted Employees and logged out.")) return;
  await fetch(`${API_BASE}/admin/employees/${id}`, { method: "DELETE" });
  loadAdminEmployees();
};

function getActor() {
  return currentUser ? currentUser.full_name : "Developer";
}

async function fetchTasks() {
  const res = await fetch(`${API_BASE}/tasks`);
  tasks = await res.json();
  renderBoard();
}

async function fetchActivity() {
  const res = await fetch(`${API_BASE}/activity`);
  const logs = await res.json();
  const list = el("activityList");
  list.innerHTML = "";
  logs.forEach((log) => prependActivity(log, false));
}

function prependActivity(log, toTop = true) {
  const list = el("activityList");
  const li = document.createElement("li");
  li.className = "activity-item";
  const time = new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  li.innerHTML = `
    <strong>${escapeHtml(log.actor)}</strong> ${escapeHtml(log.action)}:
    <em>${escapeHtml(log.task_title)}</em>
    <span class="activity-time">${time}</span>
  `;
  if (toTop) list.prepend(li);
  else list.appendChild(li);
}

function renderBoard() {
  const query = el("searchInput").value.trim().toLowerCase();
  const priorityFilter = el("priorityFilter").value;

  ["todo", "in_progress", "review", "done"].forEach((status) => {
    const col = el(`col-${status}`);
    col.innerHTML = "";

    const filtered = tasks.filter((t) => {
      if (t.status !== status) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (query) {
        const hay = `${t.title} ${t.description} ${t.assignee} ${t.tags}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    el(`count-${status}`).textContent = filtered.length;

    filtered.forEach((task) => {
      const card = document.createElement("div");
      card.className = "card";
      card.draggable = true;
      card.dataset.id = task.id;

      const tagsHtml = (task.tags || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`)
        .join("");

      card.innerHTML = `
        <div class="card-top">
          <span class="priority-badge priority-${task.priority}">${task.priority}</span>
          <div>
            <button class="icon-btn" title="Edit" onclick="openEditModal(${task.id})">&#9998;</button>
            <button class="icon-btn" title="Delete" onclick="deleteTask(${task.id})">&#128465;</button>
          </div>
        </div>
        <div class="card-title">${escapeHtml(task.title)}</div>
        ${task.description ? `<div class="card-desc">${escapeHtml(task.description)}</div>` : ""}
        ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ""}
        <div class="card-footer">
          <span>@${escapeHtml(task.assignee || "Unassigned")}</span>
          <span>#${task.id}</span>
        </div>
      `;

      card.addEventListener("dragstart", () => { draggedTaskId = task.id; });
      card.addEventListener("dragend", () => { draggedTaskId = null; });
      col.appendChild(card);
    });
  });
}

document.querySelectorAll(".column").forEach((column) => {
  column.addEventListener("dragover", (e) => {
    e.preventDefault();
    column.classList.add("drag-over");
  });
  column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
  column.addEventListener("drop", async (e) => {
    e.preventDefault();
    column.classList.remove("drag-over");
    if (!draggedTaskId) return;
    const newStatus = column.dataset.status;
    const task = tasks.find((t) => t.id === draggedTaskId);
    if (!task || task.status === newStatus) return;

    await fetch(`${API_BASE}/tasks/${draggedTaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, actor: getActor() }),
    });
  });
});

el("newTaskBtn").addEventListener("click", () => {
  el("modalTitle").textContent = "New Task";
  el("taskId").value = "";
  el("taskForm").reset();
  el("taskStatus").value = "todo";
  el("taskPriority").value = "medium";
  el("taskModal").classList.remove("hidden");
});

window.openEditModal = function (id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  el("modalTitle").textContent = `Edit Task #${task.id}`;
  el("taskId").value = task.id;
  el("taskTitle").value = task.title;
  el("taskDesc").value = task.description || "";
  el("taskStatus").value = task.status;
  el("taskPriority").value = task.priority;
  el("taskAssignee").value = task.assignee || "";
  el("taskTags").value = task.tags || "";
  el("taskModal").classList.remove("hidden");
};

window.deleteTask = async function (id) {
  await fetch(`${API_BASE}/tasks/${id}?actor=${encodeURIComponent(getActor())}`, {
    method: "DELETE",
  });
};

function closeModal() { el("taskModal").classList.add("hidden"); }
el("closeModalBtn").addEventListener("click", closeModal);
el("cancelModalBtn").addEventListener("click", closeModal);
el("searchInput").addEventListener("input", renderBoard);
el("priorityFilter").addEventListener("change", renderBoard);

el("taskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = el("taskId").value;
  const payload = {
    title: el("taskTitle").value.trim(),
    description: el("taskDesc").value.trim(),
    status: el("taskStatus").value,
    priority: el("taskPriority").value,
    assignee: el("taskAssignee").value.trim() || "Unassigned",
    tags: el("taskTags").value.trim(),
    actor: getActor(),
  };

  if (id) {
    await fetch(`${API_BASE}/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
  closeModal();
});

function connectWebSocket() {
  if (ws) ws.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({
    emp_id: currentUser ? currentUser.id : "",
    full_name: currentUser ? currentUser.full_name : "Developer",
    job_role: currentUser ? currentUser.job_role : "Employee",
  });
  ws = new WebSocket(`${proto}://${location.host}/ws?${params.toString()}`);

  ws.onopen = () => {
    el("wsDot").className = "status-dot online";
    el("wsText").textContent = "Live";
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "presence") {
      el("onlineCount").textContent = `${msg.online_count} online`;
      el("onlineSidebarCount").textContent = msg.online_count;
      onlineUserIds = new Set((msg.online_users || []).map((u) => u.id));
      if (currentUser && currentUser.role === "admin" && !el("adminView").classList.contains("hidden")) {
        const approved = adminEmployees.filter((e) => e.status === "approved");
        renderOnlineStatusColumn(approved);
      }
      const empList = el("onlineEmpList");
      empList.innerHTML = "";
      (msg.online_users || []).forEach((u) => {
        const li = document.createElement("li");
        li.className = "online-emp-item";
        li.innerHTML = `<span class="user-dot"></span><span>${escapeHtml(u.full_name)}</span>`;
        empList.appendChild(li);
      });
    } else if (msg.type === "employee_registered") {
      if (currentUser && currentUser.role === "admin") {
        loadAdminEmployees();
      }  
    } else if (msg.type === "force_logout") {
      if (currentUser && currentUser.id === msg.employee_id) {
        logoutUser("Your account was removed by Admin. You have been logged out.");
      }
    } else if (msg.type === "task_created") {
      if (!tasks.some((t) => t.id === msg.task.id)) tasks.unshift(msg.task);
      renderBoard();
      if (msg.activity) prependActivity(msg.activity);
    } else if (msg.type === "task_updated") {
      const idx = tasks.findIndex((t) => t.id === msg.task.id);
      if (idx !== -1) tasks[idx] = msg.task;
      else tasks.unshift(msg.task);
      renderBoard();
      if (msg.activity) prependActivity(msg.activity);
    } else if (msg.type === "task_deleted") {
      tasks = tasks.filter((t) => t.id !== msg.task_id);
      renderBoard();
      if (msg.activity) prependActivity(msg.activity);
    }
  };

  ws.onclose = () => {
    el("wsDot").className = "status-dot offline";
    el("wsText").textContent = "Offline";
    if (currentUser) {
      setTimeout(connectWebSocket, 2000);
    }
  };
}

setInterval(() => {
  if (currentUser && currentUser.role === "admin" && !el("adminView").classList.contains("hidden")) {
    loadAdminEmployees();
  }
}, 3000);

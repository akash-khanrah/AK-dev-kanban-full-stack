import os
import json
import hashlib
from datetime import datetime
from typing import List, Optional, Dict
from fastapi import FastAPI, Depends, HTTPException,  Form, Query
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_
from backend.database import Base, engine, get_db, SessionLocal
from backend.models import Employee, Task, ActivityLog
from backend.schemas import (
    EmployeeLogin,
    EmployeeOut,
    TaskCreate,
    TaskUpdate,
    TaskOut,
    ActivityOut,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="AK-Dev Kanban")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode("utf-8")).hexdigest()


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[WebSocket, dict] = {}

    async def connect(self, websocket: WebSocket, user_info: dict):
        await websocket.accept()
        self.active_connections[websocket] = user_info
        await self.broadcast_presence()

    def disconnect(self, websocket: WebSocket):
        user_info = self.active_connections.pop(websocket, None)
        return user_info

    async def broadcast(self, message: dict):
        payload = json.dumps(message, default=str)
        dead = []
        for connection in list(self.active_connections.keys()):
            try:
                await connection.send_text(payload)
            except Exception:
                dead.append(connection)
        for conn in dead:
            self.disconnect(conn)

    async def broadcast_presence(self):
        seen_ids = set()
        online_list = []
        for info in self.active_connections.values():
            uid = info.get("id")
            if uid and uid not in seen_ids:
                seen_ids.add(uid)
                online_list.append(info)
        await self.broadcast({
            "type": "presence",
            "online_count": len(online_list),
            "online_users": online_list,
        })


manager = ConnectionManager()


def seed_initial_data():
    db = SessionLocal()
    try:
        admin_name = os.getenv("ADMIN_NAME")
        admin_email = os.getenv("ADMIN_EMAIL")
        admin_password = os.getenv("ADMIN_PASSWORD")

        if admin_name and admin_email and admin_password:
            admin = db.query(Employee).filter(Employee.role == "admin").first()
            if not admin:
                admin = Employee(
                    full_name=admin_name.strip(),
                    email=admin_email.strip().lower(),
                    password=hash_password(admin_password),
                    mobile_number="9832816787",
                    job_role="System Administrator",
                    gender="Male",
                    dob="2006-06-16",
                    interview_mode="Online",
                    role="admin",
                    status="approved",
                )
                db.add(admin)
                db.commit()
            else:
                admin.full_name = admin_name.strip()
                admin.email = admin_email.strip().lower()
                admin.password = hash_password(admin_password)
                db.commit()

    finally:
        db.close()


seed_initial_data()


def log_activity(db: Session, actor: str, action: str, task_title: str):
    entry = ActivityLog(
        actor=actor or "Develop",
        action=action,
        task_title=task_title
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return ActivityOut.model_validate(entry).model_dump()


@app.post("/api/auth/register", response_model=EmployeeOut, status_code=201)
async def register_employee(
    full_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    mobile_number: str = Form(...),
    job_role: str = Form(...),
    gender: str = Form(...),
    dob: str = Form(...),
    interview_mode: str = Form("Online"),
    role: str = Form("employee"),
    db: Session = Depends(get_db),
):
    fields = {
        "Full Name": full_name,
        "Email": email,
        "Password": password,
        "Mobile Number": mobile_number,
        "Job Role": job_role,
        "Gender": gender,
        "Date of Birth": dob,
    }
    for label, val in fields.items():
        if not val or not str(val).strip():
            raise HTTPException(
                status_code=400,
                detail=f"{label} cannot be blank."
            )

    try:
        existing_email = db.query(Employee).filter(
            Employee.email == email.strip().lower()
            ).first()
        if existing_email:
            raise HTTPException(
                status_code=400,
                detail="Email is already registered."
                )

        pw_hash = hash_password(password)
        existing_pw = db.query(Employee).filter(
            Employee.password == pw_hash
            ).first()
        if existing_pw:
            raise HTTPException(
                status_code=400,
                detail="Please change password This password is already in use"
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500, detail="Database connection error"
            )

    emp = Employee(
        full_name=full_name.strip(),
        email=email.strip().lower(),
        password=hash_password(password),
        mobile_number=mobile_number.strip(),
        job_role=job_role.strip(),
        gender=gender,
        dob=dob,
        interview_mode=interview_mode,
        role=role if role in ("employee", "admin") else "employee",
        status="pending",
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    await manager.broadcast({
        "type": "employee_registered",
        "employee": EmployeeOut.model_validate(emp).model_dump()
    })
    return emp


@app.post("/api/auth/login", response_model=EmployeeOut)
def login_employee(payload: EmployeeLogin, db: Session = Depends(get_db)):
    ident = payload.identifier.strip()
    emp = (
        db.query(Employee)
        .filter(or_(Employee.email == ident.lower(),
                    Employee.full_name == ident))
        .first()
    )
    if not emp or emp.password != hash_password(payload.password):
        raise HTTPException(status_code=401,
                            detail="Invalid Full Name/Email or Password."
                            )
    if emp.status != "approved":
        raise HTTPException(
            status_code=403,
            detail="Login is failed,"
            \
            " sorry Your account is not accepted by Admin",
        )
    emp.last_seen_at = datetime.utcnow()
    db.commit()
    db.refresh(emp)
    return emp


@app.get("/api/profile/{emp_id}", response_model=EmployeeOut)
def get_profile(emp_id: int, db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found.")
    return emp


@app.patch("/api/profile/{emp_id}", response_model=EmployeeOut)
async def update_profile(
    emp_id: int,
    full_name: Optional[str] = Form(None),
    mobile_number: Optional[str] = Form(None),
    job_role: Optional[str] = Form(None),
    gender: Optional[str] = Form(None),
    dob: Optional[str] = Form(None),
    interview_mode: Optional[str] = Form(None),
    password: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found.")

    if full_name:
        emp.full_name = full_name.strip()
    if mobile_number:
        emp.mobile_number = mobile_number.strip()
    if job_role:
        emp.job_role = job_role.strip()
    if gender:
        emp.gender = gender
    if dob:
        emp.dob = dob
    if interview_mode:
        emp.interview_mode = interview_mode
    if password:
        emp.password = hash_password(password)

    db.commit()
    db.refresh(emp)
    return emp


@app.get("/api/admin/employees", response_model=List[EmployeeOut])
def list_employees(db: Session = Depends(get_db)):
    return db.query(Employee).order_by(Employee.id.desc()).all()


@app.post("/api/admin/employees/{emp_id}/approve", response_model=EmployeeOut)
def approve_employee(emp_id: int, db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found.")
    emp.status = "approved"
    db.commit()
    db.refresh(emp)
    return emp


@app.patch("/api/admin/employees/{emp_id}", response_model=EmployeeOut)
def admin_edit_employee(emp_id: int, payload: dict,
                        db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found.")
    # Allow editing details EXCEPT password, dob, created_at, last_seen_at
    allowed = {"full_name", "email", "mobile_number",
               "job_role", "gender", "interview_mode", "role"}
    for key in allowed:
        if key in payload and payload[key] is not None:
            val = str(payload[key]).strip()
            if key == "email":
                val = val.lower()
            setattr(emp, key, val)
    db.commit()
    db.refresh(emp)
    return emp


@app.post("/api/admin/employees/{emp_id}/restore", response_model=EmployeeOut)
def restore_employee(emp_id: int, db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found.")
    emp.status = "approved"
    db.commit()
    db.refresh(emp)
    return emp


@app.delete("/api/admin/employees/{emp_id}/permanent")
def permanent_delete_employee(emp_id: int, db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    if emp.role == "admin":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the Admin account"
            )
    db.delete(emp)
    db.commit()
    return {"permanently_deleted": True, "id": emp_id}


@app.delete("/api/admin/employees/{emp_id}")
async def delete_employee(emp_id: int, db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(
            status_code=404,
            detail="Employee not found"
            )
    if emp.role == "admin":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the Admin account"
            )
    emp.status = "deleted"
    db.commit()
    # Immediately force-logout this employee if they are logged in
    await manager.broadcast({"type": "force_logout", "employee_id": emp_id})
    return {"deleted": True, "id": emp_id}


@app.get("/api/tasks", response_model=List[TaskOut])
def list_tasks(db: Session = Depends(get_db)):
    return db.query(Task).order_by(Task.id.desc()).all()


@app.post("/api/tasks", response_model=TaskOut, status_code=201)
async def create_task(payload: TaskCreate, db: Session = Depends(get_db)):
    task = Task(
        title=payload.title.strip(),
        description=(payload.description or "").strip(),
        status=payload.status,
        priority=payload.priority,
        assignee=(payload.assignee or "Unassigned").strip(),
        tags=(payload.tags or "").strip(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    task_data = TaskOut.model_validate(task).model_dump()
    activity = log_activity(
        db, payload.actor,
        f"created task in {task.status.replace('_', ' ')}", task.title
        )

    await manager.broadcast({
        "type": "task_created",
        "task": task_data,
        "activity": activity
        })
    return task


@app.patch("/api/tasks/{task_id}", response_model=TaskOut)
async def update_task(task_id: int, payload: TaskUpdate,
                      db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    old_status = task.status
    update_data = payload.model_dump(exclude_unset=True, exclude={"actor"})
    for key, value in update_data.items():
        setattr(task, key, value.strip() if isinstance(value, str) else value)

    db.commit()
    db.refresh(task)

    task_data = TaskOut.model_validate(task).model_dump()
    if "status" in update_data and update_data["status"] != old_status:
        action = f"moved task to {task.status.replace('_', ' ')}"
    else:
        action = "updated task"
    activity = log_activity(db, payload.actor, action, task.title)

    await manager.broadcast({
        "type": "task_updated",
        "task": task_data,
        "activity": activity
        })
    return task


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, actor: str = "Developer",
                      db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    title = task.title
    db.delete(task)
    db.commit()

    activity = log_activity(db, actor, "deleted task", title)
    await manager.broadcast({
        "type": "task_deleted",
        "task_id": task_id,
        "activity": activity
        })
    return {"deleted": True, "id": task_id}


@app.get("/api/activity", response_model=List[ActivityOut])
def list_activity(db: Session = Depends(get_db)):
    return db.query(ActivityLog).order_by(
        ActivityLog.id.desc()).limit(25).all()


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    emp_id: Optional[int] = Query(None),
    full_name: str = Query("Developer"),
    job_role: str = Query("Employee"),
):
    if emp_id:
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.id == emp_id).first()
            if emp:
                emp.last_seen_at = datetime.utcnow()
                db.commit()
        finally:
            db.close()

    await manager.connect(websocket,
                          {"id": emp_id,
                           "full_name": full_name,
                           "job_role": job_role
                           }
                          )
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        info = manager.disconnect(websocket)
        if info and info.get("id"):
            db = SessionLocal()
            try:
                emp = db.query(Employee).filter(
                    Employee.id == info["id"]).first()
                if emp:
                    emp.last_seen_at = datetime.utcnow()
                    db.commit()
            finally:
                db.close()
        await manager.broadcast_presence()


app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/")
def serve_index():
    return FileResponse("frontend/index.html")

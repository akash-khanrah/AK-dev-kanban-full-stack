from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime
from backend.database import Base


class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    full_name = Column(String(150), nullable=False)
    email = Column(String(150), nullable=False, unique=True, index=True)
    password = Column(String(255), nullable=False)
    mobile_number = Column(String(30), nullable=False)
    job_role = Column(String(100), nullable=False)
    gender = Column(String(20), nullable=False)
    dob = Column(String(20), nullable=False)
    interview_mode = Column(String(20), nullable=False, default="Online")
    role = Column(String(20), nullable=False, default="employee")
    status = Column(String(20), nullable=False, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, default="")
    status = Column(String(32), nullable=False, default="todo")
    priority = Column(String(32), nullable=False, default="medium")
    assignee = Column(String(100), default="Unassigned")
    tags = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    actor = Column(String(100), nullable=False, default="Developer")
    action = Column(String(255), nullable=False)
    task_title = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

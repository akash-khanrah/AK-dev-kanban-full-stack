from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class EmployeeLogin(BaseModel):
    identifier: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class EmployeeUpdate(BaseModel):
    full_name: Optional[str] = None
    mobile_number: Optional[str] = None
    job_role: Optional[str] = None
    gender: Optional[str] = None
    dob: Optional[str] = None
    interview_mode: Optional[str] = None
    password: Optional[str] = None


class EmployeeOut(BaseModel):
    id: int
    full_name: str
    email: str
    mobile_number: str
    job_role: str
    gender: str
    dob: str
    interview_mode: str
    role: str
    status: str
    created_at: datetime
    last_seen_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = ""
    status: str = Field(default="todo",
                        pattern="^(todo|in_progress|review|done)$")
    priority: str = Field(default="medium",
                          pattern="^(low|medium|high|urgent)$")
    assignee: Optional[str] = "Unassigned"
    tags: Optional[str] = ""
    actor: Optional[str] = "Developer"


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    status: Optional[str] = Field(None,
                                  pattern="^(todo|in_progress|review|done)$")
    priority: Optional[str] = Field(None, pattern="^(low|medium|high|urgent)$")
    assignee: Optional[str] = None
    tags: Optional[str] = None
    actor: Optional[str] = "Developer"


class TaskOut(BaseModel):
    id: int
    title: str
    description: str
    status: str
    priority: str
    assignee: str
    tags: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ActivityOut(BaseModel):
    id: int
    actor: str
    action: str
    task_title: str
    created_at: datetime

    class Config:
        from_attributes = True

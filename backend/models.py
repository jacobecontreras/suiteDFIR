from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from enum import Enum

# ENUMS

class CaseStatus(str, Enum):
    ACTIVE = "Active"
    ARCHIVED = "Archived"
    CLOSED = "Closed"

class Priority(str, Enum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"

class ToolName(str, Enum):
    ILEAPP = "ileapp"
    ALEAPP = "aleapp"

# PROFILE MODELS

class ProfileBase(BaseModel):
    name: str
    tool: ToolName
    modules: List[str]

class ProfileCreate(ProfileBase):
    """Payload for creating a new tool configuration profile."""
    pass

class Profile(ProfileBase):
    """Response model for a tool configuration profile."""
    model_config = ConfigDict(from_attributes=True)
    id: int

# CASE MODELS

class CaseBase(BaseModel):
    name: str
    case_number: Optional[str] = None
    client_name: Optional[str] = None
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    description: Optional[str] = None
    status: CaseStatus = CaseStatus.ACTIVE
    priority: Priority = Priority.MEDIUM

class CaseCreate(CaseBase):
    """Payload for creating a new case."""
    pass

class CaseUpdate(BaseModel):
    """Payload for updating an existing case. All fields are optional."""
    name: Optional[str] = None
    case_number: Optional[str] = None
    client_name: Optional[str] = None
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    description: Optional[str] = None
    status: Optional[CaseStatus] = None
    priority: Optional[Priority] = None

class Case(CaseBase):
    """Response model for a case."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: str
    last_visited_at: Optional[str] = None

# PROCESSING MODELS

class ProcessRequest(BaseModel):
    """Payload for initiating a forensic tool processing job."""
    tool: ToolName
    input_path: str
    selected_modules: List[str]
    case_name: str
    case_id: Optional[int] = None
    output_folder: Optional[str] = None
    timezone: Optional[str] = None
    report_name: Optional[str] = None
    password: Optional[str] = None

class ValidateBackupRequest(BaseModel):
    input_path: str

class FilePathResponse(BaseModel):
    file_path: str
    success: bool
    message: str

# REPORT MODELS

class Report(BaseModel):
    """Response model for a generated report."""
    model_config = ConfigDict(from_attributes=True)
    name: str
    path: str
    url: str
    tool: ToolName
    created_at: str
    size: str
    artifact_count: int

# TASK/NOTEMODELS

class TaskBase(BaseModel):
    content: str
    description: Optional[str] = None
    priority: Priority = Priority.MEDIUM
    case_id: Optional[int] = None

class TaskCreate(TaskBase):
    """Payload for creating a new task."""
    pass

class Task(TaskBase):
    """Response model for a task."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    completed: bool
    created_at: str

class NoteBase(BaseModel):
    content: str
    description: Optional[str] = None
    case_id: Optional[int] = None

class NoteCreate(NoteBase):
    """Payload for creating a new note."""
    pass

class Note(NoteBase):
    """Response model for a note."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: str

# BACKUP MODELS
class BackupRequest(BaseModel):
    """Payload for triggering a device backup."""
    udid: str
    name: str
    password: Optional[str] = None
    case_id: Optional[int] = None

# BACKUP MODELS
class BackupRequest(BaseModel):
    """Payload for triggering a device backup."""
    udid: str
    name: str
    password: Optional[str] = None
    case_id: Optional[int] = None

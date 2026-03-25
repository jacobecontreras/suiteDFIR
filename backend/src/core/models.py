from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Dict
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
    """Base model for forensic tool configuration profiles."""
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
    """Base model for forensic cases containing shared case information."""
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
    case_id: int
    output_folder: Optional[str] = None
    timezone_offset: str = "UTC"
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
    id: int
    name: str
    path: str
    url: str
    tool: ToolName
    created_at: str
    size: str
    artifact_count: int

# TASK/NOTE MODELS

class TaskBase(BaseModel):
    """Base model for tasks associated with a forensic case."""
    content: str
    description: Optional[str] = None
    priority: Priority = Priority.MEDIUM
    case_id: int

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
    """Base model for notes associated with a forensic case."""
    content: str
    description: Optional[str] = None
    case_id: int

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
    case_id: int

class StopRequest(BaseModel):
    """Payload for stopping a processing job."""
    task_id: Optional[str] = None

# GENERIC RESPONSE MODELS

class MessageResponse(BaseModel):
    """Standard success message response."""
    message: str

# BACKUP RESPONSE MODELS

class DeviceInfo(BaseModel):
    """Connected iOS or Android device information."""
    udid: str
    name: str
    type: str # 'ios' or 'android'
    device_type: Optional[str] = None
    is_encrypted: Optional[bool] = None
    is_rooted: Optional[bool] = None


class BackupValidation(BaseModel):
    """Backup path validation result."""
    valid: bool
    encrypted: bool
    path: Optional[str] = None
    error: Optional[str] = None


class BackupInfo(BaseModel):
    """Backup record response."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    device_udid: str
    name: str
    device_name: str
    status: str
    path: Optional[str] = None
    created_at: str
    size: Optional[str] = None
    progress: Optional[int] = None
    type: str = "ios"
    case_id: int


class BackupStarted(BaseModel):
    """Response when backup initiated."""
    message: str
    backup_id: int

# PROCESSING RESPONSE MODELS

class ProcessingStarted(BaseModel):
    """Response when processing job initiated."""
    task_id: str
    message: str

# TOOL RESPONSE MODELS

class ToolStatus(BaseModel):
    """Individual tool installation status."""
    installed: bool
    version: Optional[str] = None
    path: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    installed_at: Optional[str] = None
    latest_version: Optional[str] = None
    update_available: Optional[bool] = None


class ToolsStatusResponse(BaseModel):
    """All tools status response."""
    ileapp: ToolStatus
    aleapp: ToolStatus

# PROFILE RESPONSE MODELS

class ProfileLoadResult(BaseModel):
    """Profile load operation result."""
    message: str
    profile_id: int
    selected_count: int
    modules: List[str]


class ModuleInfo(BaseModel):
    """Module information for a tool."""
    name: str
    category: Optional[str] = None
    display_name: Optional[str] = None
    module_name: Optional[str] = None
    enabled: bool = True
    selected: bool = False


class ModulesResponse(BaseModel):
    """Response for available modules endpoint."""
    modules: List[ModuleInfo]
    total: int


class ModuleSelectionResult(BaseModel):
    """Module selection update result."""
    message: str

# SYSTEM RESPONSE MODELS

class RootResponse(BaseModel):
    """API root endpoint response."""
    message: str
    tools: List[str]
    modules_loaded: int


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    tools_initialized: Dict[str, bool]


class SystemHealthMetrics(BaseModel):
    """System health metrics response."""
    cpu_percent: float
    memory_percent: float
    disk_percent: float


class StorageBreakdownItem(BaseModel):
    name: str
    value: int
    color: str

class StorageUsage(BaseModel):
    """Storage usage statistics."""
    total: int
    free: int
    breakdown: List[StorageBreakdownItem]

# ACTIVITY RESPONSE MODELS

class ActivityItem(BaseModel):
    """Recent activity item."""
    id: int
    name: str
    type: str
    status: str
    created_at: str
    path: Optional[str] = None


class RecentActivityResponse(BaseModel):
    """Recent activity response."""
    activities: List[ActivityItem]

# SETTINGS MODELS

class SettingValue(BaseModel):
    """Request body for updating a setting."""
    value: str


class ApiKeyVerificationResponse(BaseModel):
    """Result of verifying a Google Maps API key against required services."""
    valid: bool
    message: str

class TileSessionRequest(BaseModel):
    """Request body for creating a Google Maps tile session."""
    mapType: str = "roadmap"
    language: str = "en-US"
    region: str = "US"
    layerTypes: Optional[List[str]] = None
    overlay: Optional[bool] = None


class TileViewportRequest(TileSessionRequest):
    """Request body for retrieving Google Maps viewport attribution."""
    zoom: int
    north: float
    south: float
    east: float
    west: float

# SPATIAL RESPONSE MODELS

class KmlFileItem(BaseModel):
    """Single KML file metadata."""
    name: str
    url: str
    path: str
    is_deletable: bool


class KmlFilesResponse(BaseModel):
    """Response for KML files grouped by source."""
    files: Dict[str, List[KmlFileItem]]


class KmlImportResponse(BaseModel):
    """Response for successful KML import."""
    message: str
    filename: str


class GeocodeResult(BaseModel):
    """Single geocoding result with coordinates."""
    lat: str
    lon: str
    display_name: str


class PlaceSuggestion(BaseModel):
    """Single Google Places autocomplete suggestion."""
    place_id: str
    display_name: str
    primary_text: Optional[str] = None
    secondary_text: Optional[str] = None

# SPATIAL TILE RESPONSE MODELS

class TileSessionResponse(BaseModel):
    """Response containing Google Maps tile session details."""
    session: str
    expiry: int
    key: str
    tileWidth: int
    tileHeight: int

class InvalidateSessionResponse(BaseModel):
    """Response indicating session cache invalidation result."""
    message: str
    cacheKey: str

class TileSessionStatus(BaseModel):
    """Status details for a single cached tile session."""
    mapType: str
    expiry: int
    remainingSeconds: int
    isValid: bool

class TileSessionStatusResponse(BaseModel):
    """Active backend cache status for tile sessions."""
    cachedSessions: int
    maxSessions: int
    sessions: Dict[str, TileSessionStatus]


class TileViewportResponse(BaseModel):
    """Viewport attribution for the currently displayed Google tiles."""
    copyright: str

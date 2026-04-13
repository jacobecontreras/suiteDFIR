
import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Plus, Trash2, CheckSquare, Check } from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select"
import { useToast } from "@/hooks/use-toast"
import { useCase } from "@/context/CaseContext"
import { useDashboard } from "@/context/DashboardContext"
import { API } from "@/lib/api"

interface Task {
    id: number
    content: string
    description?: string
    priority: 'Low' | 'Medium' | 'High'
    completed: boolean
    created_at: string
    case_id?: number
}

interface Note {
    id: number
    content: string
    description?: string
    created_at: string
    case_id?: number
}

export default function TasksNotesWidget() {
    const { selectedCaseId } = useCase()
    const {
        activeTab,
        setActiveTab,
        taskInput,
        setTaskInput,
        taskDescription,
        setTaskDescription,
        taskPriority,
        setTaskPriority,
        noteInput,
        setNoteInput,
        noteDescription,
        setNoteDescription
    } = useDashboard()

    const [tasks, setTasks] = useState<Task[]>([])
    const [notes, setNotes] = useState<Note[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const { toast } = useToast()

    const fetchData = useCallback(async () => {
        if (!selectedCaseId) return

        try {
            const [tasksRes, notesRes] = await Promise.all([
                fetch(API.path(`/dashboard/tasks?case_id=${selectedCaseId}`)),
                fetch(API.path(`/dashboard/notes?case_id=${selectedCaseId}`))
            ])

            if (tasksRes.ok) setTasks(await tasksRes.json())
            if (notesRes.ok) setNotes(await notesRes.json())
        } catch (error) {
            console.error('Failed to fetch data:', error)
        }
    }, [selectedCaseId])

    useEffect(() => {
        if (selectedCaseId) {
            fetchData()
        } else {
            setTasks([])
            setNotes([])
        }
    }, [selectedCaseId, fetchData])

    const handleAdd = async () => {
        const currentInput = activeTab === 'tasks' ? taskInput : noteInput

        if (!currentInput.trim() || !selectedCaseId) return

        setIsLoading(true)
        try {
            const endpoint = activeTab === 'tasks' ? 'tasks' : 'notes'
            const body = activeTab === 'tasks'
                ? { content: taskInput, description: taskDescription, priority: taskPriority, case_id: parseInt(selectedCaseId) }
                : { content: noteInput, description: noteDescription, case_id: parseInt(selectedCaseId) }

            const res = await fetch(API.path(`/dashboard/${endpoint}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })

            if (!res.ok) throw new Error('Failed to create item')

            const newItem = await res.json()

            if (activeTab === 'tasks') {
                setTasks([newItem, ...tasks])
                setTaskInput('')
                setTaskDescription('')
                setTaskPriority('Medium')
            } else {
                setNotes([newItem, ...notes])
                setNoteInput('')
                setNoteDescription('')
            }
        } catch {
            toast({
                title: "Error",
                description: "Failed to create item",
                variant: "destructive"
            })
        } finally {
            setIsLoading(false)
        }
    }

    const handleToggleTask = async (id: number) => {
        try {
            // Optimistic update
            setTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t))

            const res = await fetch(API.path(`/dashboard/tasks/${id}`), {
                method: 'PUT'
            })

            if (!res.ok) throw new Error('Failed to update task')

            // Update with server response to be sure
            const updatedTask = await res.json()
            setTasks(prev => prev.map(t => t.id === id ? updatedTask : t))
        } catch {
            // Revert on error
            fetchData()
            toast({
                title: "Error",
                description: "Failed to update task",
                variant: "destructive"
            })
        }
    }

    const handleDelete = async (id: number, type: 'tasks' | 'notes') => {
        try {
            // Optimistic update
            if (type === 'tasks') {
                setTasks(tasks.filter(t => t.id !== id))
            } else {
                setNotes(notes.filter(n => n.id !== id))
            }

            const res = await fetch(API.path(`/dashboard/${type}/${id}`), {
                method: 'DELETE'
            })

            if (!res.ok) throw new Error('Failed to delete item')
        } catch {
            // Revert on error
            fetchData()
            toast({
                title: "Error",
                description: "Failed to delete item",
                variant: "destructive"
            })
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleAdd()
        }
    }

    const getPriorityColor = (p: string) => {
        switch (p) {
            case 'High': return 'text-white/80 border-white/20 bg-white/10'
            case 'Medium': return 'text-white/50 border-white/10 bg-white/5'
            case 'Low': return 'text-white/30 border-white/5 bg-white/5'
            default: return 'text-gray-400/50 border-gray-400/10 bg-gray-400/5'
        }
    }

    if (!selectedCaseId) {
        return (
            <Card className="bg-transparent border-none shadow-none flex flex-col overflow-hidden h-full">
                <CardContent className="flex items-center justify-center h-full text-gray-500">
                    <p className="text-sm">Select a case to view tasks and notes</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="bg-transparent border-none shadow-none flex flex-col overflow-hidden h-full">
            {/* Header Section */}
            <div className="px-0 h-10 bg-transparent flex justify-between items-center">
                <div className="flex items-center gap-2 w-full">
                    <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-2">
                        <CheckSquare size={14} className="text-gray-400/70" />
                        Tasks & Notes
                    </h3>
                    <div className="flex p-1 bg-[#212121] rounded-lg ml-auto">
                        <button
                            onClick={() => setActiveTab('tasks')}
                            className={`px-3 py-1 text-[10px] font-medium rounded-md transition-all ${activeTab === 'tasks'
                                ? 'bg-[#333333] text-white'
                                : 'text-gray-400 hover:text-gray-200'
                                }`}
                        >
                            Tasks
                        </button>
                        <button
                            onClick={() => setActiveTab('notes')}
                            className={`px-3 py-1 text-[10px] font-medium rounded-md transition-all ${activeTab === 'notes'
                                ? 'bg-[#333333] text-white'
                                : 'text-gray-400 hover:text-gray-200'
                                }`}
                        >
                            Notes
                        </button>
                    </div>
                </div>
            </div>

            <CardContent className="flex-1 flex flex-col p-0 pt-0 min-h-0">
                <div className="flex flex-col flex-1 min-h-0">
                    {/* Input Area */}
                    <div className="space-y-2.5 mb-4">
                        <div className="flex gap-2">
                            <Input
                                value={activeTab === 'tasks' ? taskInput : noteInput}
                                onChange={(e) => activeTab === 'tasks' ? setTaskInput(e.target.value) : setNoteInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={activeTab === 'tasks' ? "Add a new task..." : "Add a new note..."}
                                className="bg-[#1f1f1f] border-[#333333] text-white placeholder:text-gray-500 h-9 text-sm focus-visible:ring-1 focus-visible:ring-gray-500"
                            />
                            {activeTab === 'tasks' && (
                                <Select
                                    value={taskPriority}
                                    onValueChange={(val) => setTaskPriority(val as 'Low' | 'Medium' | 'High')}
                                >
                                    <SelectTrigger className="h-9 bg-[#1f1f1f] border-[#333333] text-white text-xs w-32 focus:ring-0 justify-center gap-2">
                                        <SelectValue placeholder="Priority" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#1A1A1A] border-[#333333] text-white max-h-[300px] overflow-y-auto">
                                        <SelectItem value="Low">Low</SelectItem>
                                        <SelectItem value="Medium">Medium</SelectItem>
                                        <SelectItem value="High">High</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={activeTab === 'tasks' ? taskDescription : noteDescription}
                                onChange={(e) => activeTab === 'tasks' ? setTaskDescription(e.target.value) : setNoteDescription(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Add a description (optional)..."
                                className="bg-[#171717] border-[#333333] text-gray-300 placeholder:text-gray-500 h-9 text-xs focus-visible:ring-1 focus-visible:ring-gray-500 flex-1"
                            />
                            <Button
                                onClick={handleAdd}
                                disabled={isLoading || (activeTab === 'tasks' ? !taskInput.trim() : !noteInput.trim())}
                                size="icon"
                                className="h-9 w-9 bg-white text-black hover:bg-gray-200 shrink-0"
                            >
                                <Plus size={16} />
                            </Button>
                        </div>
                    </div>

                    {/* List Section */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        {activeTab === 'tasks' ? (
                            tasks.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                    <p className="text-xs">No tasks yet</p>
                                </div>
                            ) : (
                                tasks.map((task) => (
                                    <div
                                        key={task.id}
                                        className="group flex items-start gap-2 p-1.5 rounded-md hover:bg-[#212121]/50 border border-transparent hover:border-[#333333]/30 transition-colors"
                                    >
                                        <button
                                            onClick={() => handleToggleTask(task.id)}
                                            className={`mt-1 h-3.5 w-3.5 rounded border flex items-center justify-center transition-colors shrink-0 ${task.completed
                                                ? 'bg-white/10 border-white/20 text-white/70'
                                                : 'border-gray-500/50 hover:border-gray-400'
                                                }`}
                                        >
                                            {task.completed && <Check size={10} strokeWidth={4} />}
                                        </button>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`truncate text-sm font-medium ${task.completed ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                                                    {task.content}
                                                </span>
                                                {task.priority && (
                                                    <span className={`text-[8px] px-1.5 py-px rounded border ${getPriorityColor(task.priority)} uppercase font-bold tracking-wider`}>
                                                        {task.priority}
                                                    </span>
                                                )}
                                            </div>
                                            {task.description && (
                                                <p className={`text-[11px] ${task.completed ? 'text-gray-600' : 'text-gray-400'} break-words leading-tight mt-0.5`}>
                                                    {task.description}
                                                </p>
                                            )}
                                        </div>

                                        <button
                                            onClick={() => handleDelete(task.id, 'tasks')}
                                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400 transition-colors"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))
                            )
                        ) : (
                            notes.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                    <p className="text-xs">No notes yet</p>
                                </div>
                            ) : (
                                notes.map((note) => (
                                    <div
                                        key={note.id}
                                        className="group flex items-start gap-2 p-1.5 rounded-md hover:bg-[#212121]/50 border border-transparent hover:border-[#333333]/30 transition-colors"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-200 whitespace-pre-wrap break-words leading-tight">
                                                {note.content}
                                            </p>
                                            {note.description && (
                                                <p className="text-[11px] text-gray-400 mt-0.5 whitespace-pre-wrap break-words leading-tight">
                                                    {note.description}
                                                </p>
                                            )}
                                            <p className="text-[9px] text-gray-600 mt-1 uppercase tracking-tighter">
                                                {new Date(note.created_at).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleDelete(note.id, 'notes')}
                                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400 transition-colors shrink-0"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))
                            )
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  CircleHelp,
  Code2,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  History,
  LockKeyhole,
  MessageSquareText,
  PanelLeft,
  Send,
  Settings2,
  ShieldCheck,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import {
  describeLocalFiles,
  readDirectoryFiles,
  writePatchedTextFile,
  type LocalAttachment,
  type LocalDirectoryHandle,
} from './lib/local-files';
import {
  canUseLocalModelFromThisApp,
  checkLocalModel,
  DEFAULT_LOCAL_MODEL_CONFIG,
  proposeLocalPatches,
  streamLocalChat,
  type AssistantAction,
  type LocalModelStatus,
  type LocalPatch,
  type LocalPatchResult,
} from './lib/local-model';

type LocalSession = { id: string; prompt: string; createdAt: Date };
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  patches?: LocalPatchResult;
  error?: boolean;
};

const suggestions = [
  { title: 'Explain this code', detail: 'Understand a file or function', icon: Code2, prompt: 'Explain what this code does, step by step.', action: 'explain' as const },
  { title: 'Write tests', detail: 'Build coverage for a function', icon: FileCode2, prompt: 'Write focused tests for the selected code. Include edge cases.', action: 'tests' as const },
  { title: 'Troubleshoot', detail: 'Find the source of an issue', icon: CircleHelp, prompt: 'Help me troubleshoot this issue. Here is what I expected and what happened:', action: 'troubleshoot' as const },
  { title: 'Make a fix', detail: 'Suggest a clear, scoped change', icon: Wrench, prompt: 'Review this code and suggest the smallest safe fix for:', action: 'fix' as const },
];

function readSavedSetting(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [endpoint, setEndpoint] = useState(() =>
    readSavedSetting('local-assistant.ollama-url', DEFAULT_LOCAL_MODEL_CONFIG.baseUrl),
  );
  const [model, setModel] = useState(() =>
    readSavedSetting('local-assistant.model', 'qwen2.5-coder:7b'),
  );
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint);
  const [draftModel, setDraftModel] = useState(model);
  const [endpointError, setEndpointError] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<LocalAttachment[]>([]);
  const [directoryHandle, setDirectoryHandle] = useState<LocalDirectoryHandle | null>(null);
  const [projectName, setProjectName] = useState('');
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modelStatus, setModelStatus] = useState<LocalModelStatus>({
    connected: false,
    models: [],
    message: 'Checking local Ollama…',
  });
  const [action, setAction] = useState<AssistantAction>('chat');
  const [isSending, setIsSending] = useState(false);
  const [isAddingFiles, setIsAddingFiles] = useState(false);
  const [activeView, setActiveView] = useState<'workbench' | 'sessions'>('workbench');
  const [toast, setToast] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    checkLocalModel({ baseUrl: endpoint, model }).then((status) => {
      if (!cancelled) setModelStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [endpoint, model]);

  useEffect(() => {
    try {
      window.localStorage.setItem('local-assistant.ollama-url', endpoint);
      window.localStorage.setItem('local-assistant.model', model);
    } catch {
      // Keeping model preferences is optional; source code is never persisted.
    }
  }, [endpoint, model]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [settingsOpen]);

  const openSettings = () => {
    setDraftEndpoint(endpoint);
    setDraftModel(model);
    setEndpointError('');
    setConnectionMessage('');
    setSettingsOpen(true);
  };

  const acceptFiles = async (picked: File[], asFolder = false) => {
    if (picked.length === 0) return;
    setIsAddingFiles(true);
    try {
      const additions = await describeLocalFiles(picked);
      setFiles((current) => {
        const existingIds = new Set(current.map((file) => file.id));
        return [...current, ...additions.filter((file) => !existingIds.has(file.id))];
      });
      if (asFolder) {
        const firstPath = additions[0]?.path;
        if (firstPath) setProjectName(firstPath.split('/')[0]);
      } else if (!projectName) {
        setProjectName(picked.length === 1 ? picked[0].name : `${picked.length} files`);
      }
      setToast(`${additions.length} local ${additions.length === 1 ? 'file' : 'files'} attached.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not attach those files.');
    } finally {
      setIsAddingFiles(false);
    }
  };

  const onFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const isFolder = event.currentTarget === folderInputRef.current;
    const picked = Array.from(event.currentTarget.files ?? []);
    setDirectoryHandle(null);
    void acceptFiles(picked, isFolder);
    event.currentTarget.value = '';
  };

  const submitPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      promptRef.current?.focus();
      return;
    }
    if (!modelStatus.connected) {
      setToast(modelStatus.message || 'Connect Ollama before asking about local code.');
      return;
    }
    if (!model || !modelStatus.models.includes(model)) {
      setToast('Choose an installed local model in connection settings first.');
      openSettings();
      return;
    }

    const id = `${Date.now()}`;
    const nextUserMessage: ChatMessage = {
      id: `${id}-user`,
      role: 'user',
      content: trimmed,
    };
    const nextAssistantMessage: ChatMessage = {
      id: `${id}-assistant`,
      role: 'assistant',
      content: '',
    };
    const history = messages.map(({ role, content }) => ({ role, content }));
    const config = { baseUrl: endpoint, model };
    setMessages((current) => [...current, nextUserMessage, nextAssistantMessage]);
    setSessions((current) => [{ id, prompt: trimmed, createdAt: new Date() }, ...current]);
    setPrompt('');
    setIsSending(true);
    setActiveView('workbench');
    try {
      if (action === 'fix') {
        const patches = await proposeLocalPatches(config, trimmed, files);
        const content = patches.patches.length
          ? `Prepared ${patches.patches.length} proposed ${patches.patches.length === 1 ? 'change' : 'changes'}. Review each diff before applying it.`
          : patches.summary;
        setMessages((current) =>
          current.map((message) =>
            message.id === nextAssistantMessage.id
              ? { ...message, content, patches }
              : message,
          ),
        );
      } else {
        await streamLocalChat(
          config,
          action,
          trimmed,
          files,
          history,
          (token) =>
            setMessages((current) =>
              current.map((message) =>
                message.id === nextAssistantMessage.id
                  ? { ...message, content: message.content + token }
                  : message,
              ),
            ),
        );
      }
    } catch (error) {
      const content =
        error instanceof Error ? error.message : 'The local model request failed.';
      setMessages((current) =>
        current.map((message) =>
          message.id === nextAssistantMessage.id
            ? { ...message, content, error: true }
            : message,
        ),
      );
    } finally {
      setIsSending(false);
      setAction('chat');
    }
  };

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const chooseFolder = async () => {
    if (!window.showDirectoryPicker) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' });
      setIsAddingFiles(true);
      const { files: picked, skippedDirectories, limitReached } = await readDirectoryFiles(root);
      const additions = await describeLocalFiles(picked);
      setFiles(additions);
      setDirectoryHandle(root);
      setProjectName(root.name);
      const suffix = skippedDirectories.length
        ? ` Skipped ${skippedDirectories.length} generated/dependency directories.`
        : '';
      const limitNotice = limitReached ? ' Stopped at the 2,000-file safety limit.' : '';
      setToast(`${additions.length} files read from ${root.name}.${suffix}${limitNotice}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setToast(error instanceof Error ? error.message : 'Could not read that folder.');
    } finally {
      setIsAddingFiles(false);
    }
  };
  const chooseFiles = () => fileInputRef.current?.click();

  const saveSettings = () => {
    const trimmed = draftEndpoint.trim().replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setEndpointError('Enter a valid local address, such as http://127.0.0.1:11434.');
      return;
    }
    const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname.toLowerCase());
    if (!localHost || parsed.protocol !== 'http:') {
      setEndpointError('For privacy, the Ollama address must use http://localhost or http://127.0.0.1.');
      return;
    }
    if (!draftModel.trim()) {
      setEndpointError('Enter a model name installed in your local Ollama library.');
      return;
    }
    setEndpoint(trimmed);
    setModel(draftModel.trim());
    setEndpointError('');
    setConnectionMessage('Settings saved on this device. Checking local Ollama…');
    setToast('Local model settings saved on this device.');
    void checkLocalModel({ baseUrl: trimmed, model: draftModel }).then(setModelStatus);
    window.setTimeout(() => setSettingsOpen(false), 650);
  };

  const checkConnection = async () => {
    setConnectionMessage('Checking Ollama on this computer…');
    const status = await checkLocalModel({ baseUrl: draftEndpoint, model: draftModel });
    setModelStatus(status);
    const modelMessage =
      status.connected && draftModel && !status.models.includes(draftModel)
        ? ` Model "${draftModel}" is not installed here.`
        : '';
    setConnectionMessage(`${status.message}${modelMessage}`);
  };

  const applyPatch = async (patch: LocalPatch) => {
    if (!directoryHandle) {
      const blob = new Blob([patch.replacement], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = patch.path.split(/[\\/]/).pop() || 'proposed-file.txt';
      link.href = url;
      link.download = `${safeName}.proposed`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast('Downloaded the proposed file. Review it before replacing your source.');
      return;
    }
    if (!window.confirm(`Apply the proposed change to ${patch.path}?`)) return;
    try {
      await writePatchedTextFile(
        directoryHandle,
        patch.path,
        patch.original,
        patch.replacement,
      );
      setFiles((current) =>
        current.map((file) =>
          file.path === patch.path
            ? {
                ...file,
                text: patch.replacement,
                file: new File([patch.replacement], file.name, {
                  type: file.mimeType,
                  lastModified: Date.now(),
                }),
              }
            : file,
        ),
      );
      setToast(`Applied the reviewed change to ${patch.path}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not apply that change.');
    }
  };

  const loadSession = (item: LocalSession) => {
    setPrompt(item.prompt);
    setActiveView('workbench');
    window.setTimeout(() => promptRef.current?.focus(), 0);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const selectedModelAvailable =
    modelStatus.connected && modelStatus.models.includes(model);
  const isLocalOrigin = canUseLocalModelFromThisApp();

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Terminal size={17} strokeWidth={2.2} /></div>
          <div>
            <div className="brand-name">Local Dev Assistant</div>
            <div className="brand-version">PRIVATE BY DESIGN</div>
          </div>
        </div>

        <div className="side-label">CURRENT PROJECT</div>
        <button className="workspace-tile workspace-select" type="button" onClick={chooseFolder} data-testid="button-select-project" aria-label="Choose a local project folder">
          <span className="folder-icon"><Folder size={15} /></span>
          <span>
            <span className="workspace-label">{projectName || 'No project selected'}</span>
            <span className="workspace-sub">{projectName ? 'Local folder attached' : 'Choose a folder to begin'}</span>
          </span>
          <ChevronRight size={14} style={{ marginLeft: 'auto', color: '#8fa69a' }} />
        </button>

        <nav className="nav-list" aria-label="Main menu">
          <button type="button" className={`nav-item ${activeView === 'workbench' ? 'active' : ''}`} onClick={() => setActiveView('workbench')} data-testid="nav-workbench">
            <PanelLeft size={15} /> Workbench
          </button>
          <button type="button" className={`nav-item ${activeView === 'sessions' ? 'active' : ''}`} onClick={() => setActiveView('sessions')} data-testid="nav-sessions">
            <History size={15} /> Local sessions
            {sessions.length > 0 && <span style={{ marginLeft: 'auto', font: '10px var(--app-font-mono)', color: '#9bb7a5' }}>{sessions.length}</span>}
          </button>
        </nav>

        <div className="side-spacer" />
        <div className="privacy-card">
          <div className="privacy-title"><ShieldCheck size={15} color="#a9cfb7" /> Your code stays yours</div>
          <p>Inference is local-only. No account, telemetry, cloud history, or hosted AI.</p>
        </div>
        <button type="button" className="nav-item sidebar-settings" onClick={openSettings} data-testid="button-sidebar-settings">
          <Settings2 size={15} /> Local model settings
        </button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="crumbs">
            <span>Workspace</span><ChevronRight size={13} /><strong>{activeView === 'sessions' ? 'Local sessions' : 'Workbench'}</strong>
          </div>
          <div className="top-actions">
            <div className="connection-pill" role="status" aria-live="polite" data-testid="status-local-model">
              <span className={`status-dot ${modelStatus.connected ? 'connected' : ''}`} />
              <span>Ollama <strong style={{ fontWeight: 600, color: '#58695e' }}>{modelStatus.connected ? 'Connected' : 'Not connected'}</strong></span>
            </div>
            <button type="button" className="icon-button" onClick={openSettings} aria-label="Open local model connection settings" title="Connection settings" data-testid="button-open-settings">
              <Settings2 size={17} />
            </button>
          </div>
        </header>

        <div className="content">
          {activeView === 'workbench' ? (
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">LOCAL WORKSPACE / 01</div>
                  <h1 className="page-title">Workbench</h1>
                  <p className="head-subtitle">{isLocalOrigin ? 'Ask about code on your machine. Nothing leaves this device.' : 'Hosted preview is privacy-locked. Run the app from localhost to connect your local model.'}</p>
                </div>
                <div className="local-tag"><LockKeyhole size={12} /> LOCAL ONLY</div>
              </div>

              <section className="workspace-body" aria-label="Ask about your code">
                {messages.length === 0 ? (
                  <>
                    <div className="empty-intro">
                      <div className="empty-symbol"><Code2 size={23} strokeWidth={1.7} /></div>
                      <h2>A quieter way to work with code.</h2>
                      <p>Choose a project or attach a file, then ask for a clear explanation, a test, or a second pair of eyes.</p>
                    </div>
                    <div className="suggestion-grid" aria-label="Suggested tasks">
                      {suggestions.map(({ title, detail, icon: Icon, prompt: sample, action: taskAction }) => (
                        <button key={title} type="button" className="suggestion" onClick={() => { setPrompt(sample); setAction(taskAction); promptRef.current?.focus(); }} data-testid={`button-suggestion-${title.toLowerCase().replaceAll(' ', '-')}`}>
                          <Icon className="suggestion-icon" size={16} strokeWidth={1.8} />
                          <span className="suggestion-title">{title}</span>
                          <span className="suggestion-desc">{detail}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="message-list" aria-label="Current conversation" data-testid="list-chat-messages">
                    {messages.map((message) => (
                      <article key={message.id} className={`message ${message.role === 'user' ? 'user' : ''} ${message.error ? 'message-error' : ''}`} data-testid={`message-${message.id}`}>
                        <strong className="message-author">{message.role === 'user' ? 'You' : 'Local assistant'}</strong>
                        <div className="message-content">{message.content || (isSending ? 'Thinking…' : '')}</div>
                        {message.patches?.patches.map((patch, index) => (
                          <details className="patch-preview" key={`${patch.path}-${index}`}>
                            <summary>{patch.path} · review proposed change</summary>
                            <div className="patch-columns">
                              <section><h3>Before</h3><pre>{patch.original}</pre></section>
                              <section><h3>Proposed</h3><pre>{patch.replacement}</pre></section>
                            </div>
                            <button type="button" className="modal-primary" onClick={() => void applyPatch(patch)} data-testid={`button-apply-patch-${index}`}>
                              {directoryHandle ? 'Review & apply to local file' : 'Download proposed file'}
                            </button>
                          </details>
                        ))}
                      </article>
                    ))}
                    {isSending && <div className="thinking-state" role="status" aria-live="polite">Local model is working…</div>}
                    <div ref={messagesEndRef} />
                  </div>
                )}

                <form className="composer" onSubmit={submitPrompt}>
                  {files.length > 0 && (
                    <div className="attached-list" aria-label="Attached local files">
                      {files.map((file) => (
                        <span className="file-chip" key={file.id} title={`${file.path} · ${formatBytes(file.size)} · ${file.note ?? file.kind}`}>
                          <FileCode2 size={12} />
                          <span>{file.path.split('/').pop()} <span style={{ color: '#9aa198' }}>{formatBytes(file.size)}</span></span>
                          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))} data-testid={`button-remove-file-${file.id}`}><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <label htmlFor="prompt-input" className="sr-only">Ask a question about your local code</label>
                  <textarea
                    id="prompt-input"
                    ref={promptRef}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={onComposerKeyDown}
                    placeholder="Ask a question about your code..."
                    aria-label="Ask a question about your local code"
                    data-testid="input-prompt"
                  />
                  <div className="composer-footer">
                    <div className="attach-actions">
                      <button type="button" className="subtle-button" onClick={() => void chooseFolder()} disabled={isAddingFiles || isSending} data-testid="button-attach-folder"><FolderOpen size={14} /> {isAddingFiles ? 'Reading…' : 'Add folder'}</button>
                      <button type="button" className="subtle-button" onClick={chooseFiles} disabled={isAddingFiles || isSending} data-testid="button-attach-files"><FilePlus2 size={14} /> Add files</button>
                    </div>
                    <div className="send-actions">
                      <span className="keyboard-hint">⌘ ↵</span>
                      <button className="send-button" type="submit" disabled={!prompt.trim() || !selectedModelAvailable || isSending} title={selectedModelAvailable ? 'Send this prompt to your local Ollama model' : 'Connect Ollama and choose an installed model first'} data-testid="button-send-prompt">
                        {isSending ? 'Working…' : 'Ask locally'} <Send size={13} />
                      </button>
                    </div>
                  </div>
                </form>

                <div className="session-state" data-testid="status-model-detail">
                  <span className={`status-dot ${selectedModelAvailable ? 'connected' : ''}`} />
                  <span><strong>{selectedModelAvailable ? 'Local model ready' : modelStatus.connected ? 'Model not installed' : 'Model not connected'}</strong> — {modelStatus.connected && model && !selectedModelAvailable ? `Install or select a local model. ${modelStatus.message}` : modelStatus.message}</span>
                  <button type="button" className="subtle-button" onClick={openSettings} data-testid="button-connect-ollama">{selectedModelAvailable ? 'Settings' : 'Set up'} <ArrowRight size={12} /></button>
                </div>
                <p className="local-note"><LockKeyhole size={11} /> {files.length} file{files.length === 1 ? '' : 's'} attached in browser memory. {selectedModelAvailable ? 'Prompts go only to Ollama on this computer.' : 'No prompt is sent until a local model is ready.'}</p>
              </section>
            </>
          ) : (
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">ON THIS DEVICE / 02</div>
                  <h1 className="page-title">Local sessions</h1>
                  <p className="head-subtitle">Recent prompts are kept in memory for this browser session only.</p>
                </div>
                <button type="button" className="subtle-button" onClick={() => setActiveView('workbench')} data-testid="button-back-workbench"><ArrowLeft size={14} /> Back to workbench</button>
              </div>
              <section style={{ maxWidth: 760, width: '100%', margin: '42px auto 0' }}>
                {sessions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '52px 20px', border: '1px dashed #d6d8ce', borderRadius: 10, background: 'rgba(250,249,244,.55)' }}>
                    <div className="empty-symbol"><History size={21} /></div>
                    <h2 style={{ font: '700 21px var(--app-font-serif)', letterSpacing: '-.04em', margin: '0 0 8px' }}>No local sessions yet</h2>
                    <p style={{ color: '#7b837d', fontSize: 12, margin: '0 0 18px' }}>Prompts you write here stay in memory and appear in this list.</p>
                    <button type="button" className="modal-primary" onClick={() => setActiveView('workbench')} data-testid="button-start-session">Start a session</button>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {sessions.map((item) => (
                      <button type="button" key={item.id} onClick={() => loadSession(item)} data-testid={`button-load-session-${item.id}`} style={{ width: '100%', textAlign: 'left', background: '#faf9f4', border: '1px solid #e1dfd6', borderRadius: 8, padding: '15px 16px', color: '#46594d', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <MessageSquareText size={16} color="#64816f" />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.prompt}</span>
                          <span style={{ display: 'block', marginTop: 5, color: '#92988f', font: '10px var(--app-font-mono)' }}>{item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · in-memory session</span>
                        </span>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesPicked} aria-label="Choose local code files" data-testid="input-local-files" />
      <input ref={folderInputRef} type="file" multiple hidden onChange={onFilesPicked} aria-label="Choose a local project folder" data-testid="input-local-folder" />

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-describedby="settings-description">
            <div className="modal-heading">
              <div>
                <div className="eyebrow">LOCAL INFERENCE</div>
                <h2 id="settings-title">Model connection</h2>
                <p id="settings-description">Connect to Ollama running on this machine. Remote hosts are not allowed.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Close connection settings" data-testid="button-close-settings"><X size={17} /></button>
            </div>
            <label className="field-label" htmlFor="ollama-endpoint">Ollama address</label>
            <input id="ollama-endpoint" className="text-field" type="url" value={draftEndpoint} onChange={(event) => { setDraftEndpoint(event.target.value); setEndpointError(''); }} spellCheck={false} autoComplete="url" aria-describedby="endpoint-help endpoint-error" data-testid="input-ollama-endpoint" />
            <p className="field-help" id="endpoint-help">Default: http://127.0.0.1:11434 · Only localhost addresses are accepted.</p>
            {endpointError && <p id="endpoint-error" role="alert" style={{ margin: '7px 0 0', color: '#a64c43', fontSize: 10 }}>{endpointError}</p>}

            <label className="field-label" htmlFor="ollama-model">Model name</label>
            <input id="ollama-model" className="text-field" type="text" list="ollama-model-options" value={draftModel} onChange={(event) => setDraftModel(event.target.value)} placeholder="qwen2.5-coder:7b" data-testid="input-ollama-model" />
            <datalist id="ollama-model-options">
              {modelStatus.models.map((installedModel) => <option key={installedModel} value={installedModel} />)}
              <option value="qwen2.5-coder:7b" />
              <option value="codellama:7b" />
              <option value="deepseek-coder:6.7b" />
            </datalist>
            <p className="field-help">Use a model already installed in your local Ollama library.</p>

            <div className="privacy-callout">
              <ShieldCheck size={15} style={{ flex: '0 0 auto', marginTop: 1 }} />
              <span><strong>Local-only by design.</strong> Model requests are allowed only when this page is opened from localhost and only to a loopback Ollama address. The hosted preview is locked.</span>
            </div>
            <div className="modal-actions">
              <div>
                <button type="button" className="subtle-button" onClick={() => void checkConnection()} data-testid="button-test-connection"><Activity size={13} /> Check connection</button>
                {connectionMessage && <div className="test-result" role="status" aria-live="polite" style={{ marginTop: 7, maxWidth: 245 }}>{connectionMessage}</div>}
              </div>
              <button type="button" className="modal-primary" onClick={saveSettings} data-testid="button-save-settings">Save settings</button>
            </div>
          </section>
        </div>
      )}
      {toast && <div className="toast-message" role="status" aria-live="polite" data-testid="status-toast">{toast}</div>}
    </div>
  );
}

export default App;

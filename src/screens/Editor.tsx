import type { ReactNode } from 'react';
import { ArrowLeft, BookOpen, Settings } from 'lucide-react';

import type { RedCardProject } from '../types';

import '../styles/editor.css';

export type EditorStage = 'draft' | 'cards' | 'cover' | 'export';

export type WorkspaceColumn = {
  id: string;
  label: string;
  note?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  body: ReactNode;
};

type EditorProps = {
  project: RedCardProject;
  activeStage: EditorStage;
  saveState: 'idle' | 'saving' | 'saved';
  status: ReactNode;
  hiddenExportCards: ReactNode;
  onBackHome: () => void;
  onProjectNameChange: (name: string) => void;
  onOpenRules: () => void;
  onOpenProvider: () => void;
  onStage: (stage: EditorStage) => void;
  onPrev: () => void;
  onNext: () => void;
  canNext: boolean;
  rawInput: string;
  articleDraft: string;
  articleInstruction: string;
  focusedModule: string;
  busy: string | null;
  canViewSpec: boolean;
  onRawInputChange: (value: string) => void;
  onArticleDraftChange: (value: string) => void;
  onArticleInstructionChange: (value: string) => void;
  onFocusModule: (name: string) => void;
  onGenerateArticle: () => void;
  onViewSpec: () => void;
  onConfirmCards: () => void;
  onRunDbCheck: () => void;
  onRunArticleRevision: () => void;
  draftStatus: {
    source?: ReactNode;
    article?: ReactNode;
    check?: ReactNode;
    revision?: ReactNode;
  };
  dbCheckReport: ReactNode;
  specReview: ReactNode;
  cardsColumns: WorkspaceColumn[];
  coverColumns: WorkspaceColumn[];
  exportColumns: WorkspaceColumn[];
};

const EDITOR_STAGES: Array<{ key: EditorStage; num: string; label: string }> = [
  { key: 'draft', num: '01', label: '长文' },
  { key: 'cards', num: '02', label: '文字卡片' },
  { key: 'cover', num: '03', label: 'AI 封面' },
  { key: 'export', num: '04', label: '导出发布' },
];

export default function Editor({
  project,
  activeStage,
  saveState,
  status,
  hiddenExportCards,
  onBackHome,
  onProjectNameChange,
  onOpenRules,
  onOpenProvider,
  onStage,
  onPrev,
  onNext,
  canNext,
  rawInput,
  articleDraft,
  articleInstruction,
  focusedModule,
  busy,
  canViewSpec,
  onRawInputChange,
  onArticleDraftChange,
  onArticleInstructionChange,
  onFocusModule,
  onGenerateArticle,
  onViewSpec,
  onConfirmCards,
  onRunDbCheck,
  onRunArticleRevision,
  draftStatus,
  dbCheckReport,
  specReview,
  cardsColumns,
  coverColumns,
  exportColumns,
}: EditorProps) {
  return (
    <div className="editor-root">
      <EditorTopBar
        project={project}
        saveState={saveState}
        onBackHome={onBackHome}
        onProjectNameChange={onProjectNameChange}
        onOpenRules={onOpenRules}
        onOpenProvider={onOpenProvider}
      />
      <StepIndicator activeStage={activeStage} onStage={onStage} onPrev={onPrev} onNext={onNext} canNext={canNext} />
      {activeStage === 'draft' && specReview}
      {activeStage === 'draft' && !specReview && (
        <DraftStep
          rawInput={rawInput}
          articleDraft={articleDraft}
          articleInstruction={articleInstruction}
          focusedModule={focusedModule}
          busy={busy}
          canViewSpec={canViewSpec}
          onRawInputChange={onRawInputChange}
          onArticleDraftChange={onArticleDraftChange}
          onArticleInstructionChange={onArticleInstructionChange}
          onFocusModule={onFocusModule}
          onGenerateArticle={onGenerateArticle}
          onViewSpec={onViewSpec}
          onConfirmCards={onConfirmCards}
          onRunDbCheck={onRunDbCheck}
          onRunArticleRevision={onRunArticleRevision}
          draftStatus={draftStatus}
          dbCheckReport={dbCheckReport}
        />
      )}
      {activeStage === 'cards' && <CardsStep columns={cardsColumns} />}
      {activeStage === 'cover' && <CoverStep columns={coverColumns} />}
      {activeStage === 'export' && <ExportStep columns={exportColumns} />}
      {status}
      {hiddenExportCards}
    </div>
  );
}

function EditorTopBar({
  project,
  saveState,
  onBackHome,
  onProjectNameChange,
  onOpenRules,
  onOpenProvider,
}: {
  project: RedCardProject;
  saveState: 'idle' | 'saving' | 'saved';
  onBackHome: () => void;
  onProjectNameChange: (name: string) => void;
  onOpenRules: () => void;
  onOpenProvider: () => void;
}) {
  return (
    <header className="editor-topbar">
      <div className="editor-topbar-inner">
        <div className="editor-topbar-left">
          <button className="editor-icon-btn" onClick={onBackHome} title="返回项目首页">
            <ArrowLeft className="editor-topbar-icon" />
          </button>
          <span className="editor-logo">RedCard</span>
          <span className="editor-divider">/</span>
          <input
            value={project.name}
            onChange={(e) => onProjectNameChange(e.target.value)}
            className="editor-project-name"
          />
          <span className={`editor-saved-status ${saveState}`}>
            <span className="editor-saved-dot" />
            {saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Idle'}
          </span>
        </div>
        <div className="editor-topbar-actions">
          <button className="editor-ghost-btn" onClick={onOpenRules}>
            <BookOpen className="editor-ghost-icon" />
            知识档
          </button>
          <button className="editor-icon-btn" onClick={onOpenProvider} title="Provider 设置">
            <Settings className="editor-topbar-icon" />
          </button>
        </div>
      </div>
    </header>
  );
}

function StepIndicator({
  activeStage,
  onStage,
  onPrev,
  onNext,
  canNext,
}: {
  activeStage: EditorStage;
  onStage: (stage: EditorStage) => void;
  onPrev: () => void;
  onNext: () => void;
  canNext: boolean;
}) {
  return (
    <nav className="step-indicator" aria-label="编辑流程">
      <div className="step-indicator-inner">
        <button className="step-nav-btn prev" onClick={onPrev}>上一步</button>
        <div className="step-tabs">
          {EDITOR_STAGES.map((stage, index) => (
            <div className="step-indicator-item" key={stage.key}>
              <button
                className={`step-tab ${stage.key === activeStage ? 'active' : ''}`}
                onClick={() => onStage(stage.key)}
              >
                <span className="step-tab-num">{stage.num}</span>
                <span className="step-tab-label">{stage.label}</span>
              </button>
              {index < EDITOR_STAGES.length - 1 && <span className="step-dots">···</span>}
            </div>
          ))}
        </div>
        {activeStage === 'export' ? (
          <span className="step-nav-spacer" aria-hidden="true" />
        ) : (
          <button className="step-nav-btn next" onClick={onNext} disabled={!canNext}>下一步</button>
        )}
      </div>
    </nav>
  );
}

function WorkspaceShell({
  columns,
  template = 'repeat(3, minmax(0, 1fr))',
}: {
  columns: WorkspaceColumn[];
  template?: string;
}) {
  return (
    <section className="workspace" style={{ gridTemplateColumns: template }}>
      {columns.map((column) => (
        <section className="col" key={column.id}>
          <div className="col-head">
            <div className="col-title">
              <span>[{column.id}]</span>
              <h2>{column.label}</h2>
              {column.note && <span className="col-note">{column.note}</span>}
              {column.status && <span className="col-status">{column.status}</span>}
            </div>
            {column.actions && <div className="col-actions">{column.actions}</div>}
          </div>
          <div className="col-body">{column.body}</div>
        </section>
      ))}
    </section>
  );
}

function DraftStep({
  rawInput,
  articleDraft,
  articleInstruction,
  focusedModule,
  busy,
  canViewSpec,
  onRawInputChange,
  onArticleDraftChange,
  onArticleInstructionChange,
  onFocusModule,
  onGenerateArticle,
  onViewSpec,
  onConfirmCards,
  onRunDbCheck,
  onRunArticleRevision,
  draftStatus,
  dbCheckReport,
}: {
  rawInput: string;
  articleDraft: string;
  articleInstruction: string;
  focusedModule: string;
  busy: string | null;
  canViewSpec: boolean;
  onRawInputChange: (value: string) => void;
  onArticleDraftChange: (value: string) => void;
  onArticleInstructionChange: (value: string) => void;
  onFocusModule: (name: string) => void;
  onGenerateArticle: () => void;
  onViewSpec: () => void;
  onConfirmCards: () => void;
  onRunDbCheck: () => void;
  onRunArticleRevision: () => void;
  draftStatus: {
    source?: ReactNode;
    article?: ReactNode;
    check?: ReactNode;
    revision?: ReactNode;
  };
  dbCheckReport: ReactNode;
}) {
  return (
    <WorkspaceShell
      template="1.1fr 1.5fr 1.4fr"
      columns={[
        {
          id: '01',
          label: 'SOURCE',
          status: draftStatus.source,
          body: (
            <div className="draft-column-content">
              <textarea
                value={rawInput}
                onChange={(e) => onRawInputChange(e.target.value)}
                onFocus={() => onFocusModule('source')}
                className={`editor-textarea ${focusedModule === 'source' ? 'focused' : ''}`}
                placeholder={'把要写的素材贴这里。例如：\n· 一段访谈的逐字稿\n· 你昨晚 flomo 里的几条灵感\n· 一篇要二次创作的播客文稿'}
              />
              <button
                className="editor-filled-btn"
                onClick={onGenerateArticle}
                disabled={busy === 'spec' || busy === 'article' || !rawInput.trim()}
              >
                {articleDraft.trim() ? '重新生成长文' : '生成长文'}
              </button>
            </div>
          ),
        },
        {
          id: '02',
          label: 'ARTICLE',
          status: draftStatus.article,
          actions: (
            <>
              <button className="editor-text-link" onClick={onViewSpec} disabled={!canViewSpec}>查看 SPEC</button>
              <button className="editor-mini-filled" onClick={onConfirmCards} disabled={!articleDraft.trim()}>确认进入卡片</button>
            </>
          ),
          body: (
            <textarea
              value={articleDraft}
              onChange={(e) => onArticleDraftChange(e.target.value)}
              onFocus={() => onFocusModule('article')}
              className={`editor-textarea article ${focusedModule === 'article' ? 'focused' : ''}`}
              placeholder="点 [01] 底部的「生成长文」后，系统会先抽取 SPEC，再直接生成文章。"
            />
          ),
        },
        {
          id: '03',
          label: 'dbskill check',
          note: 'from dontbesilent',
          status: draftStatus.check,
          body: (
            <div className="check-column">
              <div className="check-block">
                <span className="editor-sub-label">诊断报告</span>
                {dbCheckReport}
                <button className="editor-outline-btn" onClick={onRunDbCheck} disabled={busy === 'db-check' || !articleDraft.trim()}>
                  运行检查
                </button>
              </div>
              <div className="editor-hairline" />
              <div className="check-block revision">
                <div className="editor-sub-label-row">
                  <span className="editor-sub-label">修订</span>
                  {draftStatus.revision && <span className="inline-status">{draftStatus.revision}</span>}
                </div>
                <textarea
                  value={articleInstruction}
                  onChange={(e) => onArticleInstructionChange(e.target.value)}
                  onFocus={() => onFocusModule('revise')}
                  className={`editor-textarea revision ${focusedModule === 'revise' ? 'focused' : ''}`}
                  placeholder={'根据诊断报告或你的主观判断，写下修改要求。例如：\n· 开头太软，重写一个钩子\n· 第三段太散，合并成两段\n· 把举例换成你的案例'}
                />
                <button
                  className="editor-filled-btn"
                  onClick={onRunArticleRevision}
                  disabled={busy === 'article' || !articleDraft.trim() || !articleInstruction.trim()}
                >
                  修改
                </button>
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}

function CardsStep({ columns }: { columns: WorkspaceColumn[] }) {
  return <WorkspaceShell columns={columns} template="minmax(280px, .95fr) minmax(460px, 1.45fr) minmax(260px, .85fr)" />;
}

function CoverStep({ columns }: { columns: WorkspaceColumn[] }) {
  return <WorkspaceShell columns={columns} template="1.05fr 1.5fr 1.05fr" />;
}

function ExportStep({ columns }: { columns: WorkspaceColumn[] }) {
  return (
    <section className="export-stage">
      {columns.map((column, index) => (
        <section className={`col ${index === 0 ? 'export-top' : 'export-main'}`} key={column.id}>
          <div className="col-head">
            <div className="col-title">
              <span>[{column.id}]</span>
              <h2>{column.label}</h2>
              {column.note && <span className="col-note">{column.note}</span>}
              {column.status && <span className="col-status">{column.status}</span>}
            </div>
            {column.actions && <div className="col-actions">{column.actions}</div>}
          </div>
          <div className="col-body">{column.body}</div>
        </section>
      ))}
    </section>
  );
}

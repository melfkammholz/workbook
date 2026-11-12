import { ArrowLeft, CircleHelp, ClipboardList, Highlighter, Layers, Library, Menu, MessageCircleQuestion, NotebookText, PawPrint, PanelLeftClose, PanelLeftOpen, Search, Trophy, X } from 'lucide-react';
import { Suspense, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Route, Router, Switch, useLocation, useRoute } from 'wouter';
import { useAppLocation } from '@/lib/history';
import { Celebration } from '@/components/Celebration';
import { AddCourseForm, CourseDialog } from '@/components/CourseDialog';
import { CourseMenu, FocusQuestion } from '@/components/Focus';
import { OutlinePanel } from '@/components/Outline';
import { SearchDialog } from '@/components/SearchDialog';
import { QuickSettings } from '@/components/QuickMenus';
import { SaveNotice } from '@/components/SaveNotice';
import { SetupDialog } from '@/components/SetupDialog';
import { Empty, IconButton, Spinner, TipLayer, clsx } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AppQueries, checkCourseUpdates, keys, statusOf, useCourses, useOutlineQuery, useSettings, useStateQuery, useState_ } from '@/lib/api';
import { useFlashcards } from '@/lib/flashcards';
import { useFilters } from '@/lib/filters';
import { focusExercises } from '@/lib/focus';
import { useDocumentLang, useT } from '@/lib/i18n';
import { canGoBack } from '@/lib/history';
import { scrollPage, scrollToEdge, usePageKeys } from '@/lib/keys';
import { applyTheme } from '@/lib/theme';
import { useMediaQuery } from '@/lib/useActiveTime';
import { Dashboard } from '@/pages/Dashboard';
import {
  AchievementsPage,
  AdventurePage,
  ChapterPage,
  DeckPage,
  FlashcardReview,
  FlashcardsPage,
  HelpPage,
  HighlightsPage,
  ItemPage,
  KindPage,
  LandingPage,
  LibraryPage,
  MaterialsPage,
  NotesPage,
  PdfPage,
  QuestionsPage,
  ReviewPage,
  SettingsPage,
  StrugglingPage,
  preloadLinks,
  preloadRoute,
} from '@/lib/routes';
import { typstContext } from '@/lib/typstContext';
import { AnnotationLayer } from '@/components/AnnotationLayer';
import { QuestionPopup } from '@/components/QuestionPopup';
import { PdfRefPicker } from '@/components/PdfRefPicker';
import { useRewards } from '@/lib/rewards';
import { THREAD_KINDS, type ThreadKind } from '@wb/shared';

export function App() {
  useEffect(() => {
    preloadRoute(location.hash.slice(1));
    return preloadLinks();
  }, []);
  return (
    <Router hook={useAppLocation}>
      <AppQueries />
      <Shell />
      <SaveNotice />
      <TipLayer />
    </Router>
  );
}

/** Which course is open decides everything else, so the first course comes before the rest of the app. */
function Shell() {
  const t = useT();
  useDocumentLang();
  const courses = useCourses();
  const settings = useSettings().data;

  useEffect(() => {
    if (settings) applyTheme(settings.theme, settings.duskColor, settings.warmPaper);
  }, [settings?.theme, settings?.duskColor, settings?.warmPaper]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (settings) document.documentElement.dataset.colors = settings.safeColors ? 'safe' : 'default';
  }, [settings?.safeColors]); // eslint-disable-line react-hooks/exhaustive-deps

  // Editors read this from CSS, so changing it needs no rebuilding of any of them.
  useEffect(() => {
    if (settings) document.documentElement.style.setProperty('--editor-font-size', `${settings.editorFontSize}px`);
  }, [settings?.editorFontSize]); // eslint-disable-line react-hooks/exhaustive-deps

  if (courses.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!courses.data) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.serverGone}>{t.serverGoneBody}</Empty>
      </div>
    );
  }
  if (courses.data.activeId === null) return <NoCourse />;
  // A fresh start per course: filters and open dialogs belong to the previous one.
  return <CourseShell key={courses.data.activeId} />;
}

/** Flashcards and the library belong to no course, so they have their own routes in both shells. */
function flashcardRoutes() {
  return [
    <Route key="list" path="/flashcards" component={FlashcardsPage} />,
    <Route key="deck" path="/flashcards/deck/:id">
      {(p) => <DeckPage key={p.id} id={p.id} />}
    </Route>,
    <Route key="card" path="/flashcards/deck/:id/card/:card">
      {(p) => <DeckPage key={`${p.id}/${p.card}`} id={p.id} card={p.card} />}
    </Route>,
    <Route key="review" path="/flashcards/review/:decks">
      {(p) => <FlashcardReview key={p.decks} deckIds={p.decks.split(',')} />}
    </Route>,
    <Route key="look" path="/flashcards/look">
      {() => <StrugglingPage deckId={null} />}
    </Route>,
    <Route key="look-deck" path="/flashcards/look/:deck">
      {(p) => <StrugglingPage key={p.deck} deckId={p.deck} />}
    </Route>,
    <Route key="library" path="/library" component={LibraryPage} />,
    <Route key="pdf" path="/resources/:id/:highlight?">
      {(p) => <PdfPage id={decodeURIComponent(p.id)} highlight={p.highlight ? decodeURIComponent(p.highlight) : undefined} />}
    </Route>,
    <Route key="help" path="/help">
      {() => <HelpPage />}
    </Route>,
    <Route key="help-section" path="/help/:section">
      {(p) => <HelpPage section={p.section} />}
    </Route>,
  ];
}

function NoCourse() {
  const t = useT();
  const [location, navigate] = useLocation();
  const flashcardsOn = !!useSettings().data?.showFlashcards;
  const materialsOn = !!useSettings().data?.showMaterials;
  usePageKeys({
    h: () => canGoBack() && history.back(),
    l: () => history.forward(),
    j: (e) => scrollPage(1, e.repeat),
    k: (e) => scrollPage(-1, e.repeat),
    '?': () => navigate('/help/keys'),
    'g h': () => navigate('/'),
    'g f': flashcardsOn ? () => navigate('/flashcards') : undefined,
    'g l': materialsOn ? () => navigate('/library') : undefined,
  });
  if (location.startsWith('/flashcards') || location.startsWith('/library') || location.startsWith('/resources/') || location.startsWith('/help')) {
    return (
      <div className="flex h-full flex-col">
        <header className="wb-chrome-bar flex h-12 shrink-0 items-center gap-1 border-b border-line bg-sheet px-2 text-ink">
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-sunk hover:text-ink">
            <ArrowLeft size={16} /> {t.noCourseTitle}
          </Link>
        </header>
        <main className="min-h-0 flex-1">
          <Suspense>
            <Switch>{flashcardRoutes()}</Switch>
          </Suspense>
        </main>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg px-6 pb-24 pt-16">
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.noCourseTitle}</h1>
        <p className="mb-6 mt-2 text-ink-2">{t.noCourseBody}</p>
        <AddCourseForm autoFocus />
        <p className={clsx('mt-3 text-sm text-ink-2', !materialsOn && 'hidden')}>
          <Link href="/library" className="font-medium text-accent hover:underline">
            {t.library}
          </Link>
        </p>
        <p className={clsx('mt-10 text-sm text-ink-2', !flashcardsOn && 'hidden')}>
          {t.flashcardsWithoutCourse}{' '}
          <Link href="/flashcards" className="font-medium text-accent hover:underline">
            {t.flashcards}
          </Link>
        </p>
      </div>
      <SetupDialog />
    </div>
  );
}

function CourseShell() {
  const t = useT();
  const qc = useQueryClient();
  const outline = useOutlineQuery();
  const courses = useCourses().data;
  const stateQuery = useStateQuery();
  const achievementsOn = !!useSettings().data?.showAchievements;
  const rewardIcon = useRewards().icon;
  const flashcardsOn = !!useSettings().data?.showFlashcards;
  const materialsOn = !!useSettings().data?.showMaterials;
  const annotationsOn = !!useSettings().data?.showAnnotations;
  const state = useState_().data?.state;
  const { filters, patch, reset } = useFilters();
  const [, params] = useRoute('/item/:id');
  const [, groupParams] = useRoute('/item/:id/in/:group');
  const currentId = params?.id ?? groupParams?.id ?? null;
  const wide = useMediaQuery('(min-width: 1024px)');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('wb-outline-collapsed') === '1';
    } catch {
      return false;
    }
  });
  // A PDF has the whole width: the outline is out of the way there, and a button (or `b`) brings it back.
  const inViewer = useLocation()[0].startsWith('/resources/');
  const [viewerOutline, setViewerOutline] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // Stable, so the outline's memoized rows are not all drawn again whenever the shell is.
  const closeDrawer = useCallback(() => setDrawer(false), []);
  /** `b`: the outline in or out of sight, as the button next to the course's name does; the drawer on a narrow screen. */
  const toggleOutline = () => {
    if (!matchMedia('(min-width: 1024px)').matches) return setDrawer((d) => !d);
    if (inViewer) return setViewerOutline((v) => !v);
    setCollapsed((c) => {
      try {
        localStorage.setItem('wb-outline-collapsed', c ? '0' : '1');
      } catch {
        /* it just is not remembered */
      }
      return !c;
    });
  };
  const [searching, setSearching] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [location, navigate] = useLocation();

  // The landing page opens once, on arriving at the home page of a new course. Links to anything else still work.
  const showLanding = !!outline.data?.landing && state?.landingSeen === false && location === '/';
  useEffect(() => {
    if (showLanding) navigate('/welcome', { replace: true });
  }, [showLanding, navigate]);

  // Whatever the student does shows up in their state, so this is when something may have been earned.
  useEffect(() => {
    if (achievementsOn && stateQuery.dataUpdatedAt) void qc.invalidateQueries({ queryKey: keys.achievements });
  }, [achievementsOn, stateQuery.dataUpdatedAt, qc]);

  // On every start and every change of course. Failing quietly is fine: it only means no news.
  useEffect(() => {
    void checkCourseUpdates().then(
      (data) => qc.setQueryData(keys.courses, data),
      () => undefined,
    );
  }, [qc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // Single keys, as on many sites; `?` lists them all.
  usePageKeys({
    h: () => canGoBack() && history.back(),
    l: () => history.forward(),
    j: (e) => scrollPage(1, e.repeat),
    k: (e) => scrollPage(-1, e.repeat),
    'g g': () => scrollToEdge('top'),
    G: () => scrollToEdge('bottom'),
    b: () => toggleOutline(),
    '/': () => setSearching(true),
    '?': () => navigate('/help/keys'),
    'g h': () => navigate('/'),
    'g r': () => navigate('/review'),
    'g n': () => navigate('/notes'),
    'g f': flashcardsOn ? () => navigate('/flashcards') : undefined,
    'g a': annotationsOn ? () => navigate('/highlights') : undefined,
    'g l': materialsOn ? () => navigate('/materials') : undefined,
    'g m': achievementsOn ? () => navigate('/achievements') : undefined,
    'g q': () => navigate('/questions'),
  });

  useEffect(() => {
    if (outline.data) document.title = outline.data.title;
  }, [outline.data]);

  // What the Typst editors offer: this course's exercises and tags.
  useEffect(() => {
    const o = outline.data;
    typstContext.course = o?.id ?? null;
    typstContext.exercises = o ? o.chapters.flatMap((c) => c.items.map((i) => ({ id: i.id, title: i.title }))) : [];
    // Topics only: signals say what an exercise is like, not what a card is about.
    typstContext.tags = o ? o.tags.filter((tag) => tag.type === 'topic').map((tag) => ({ id: tag.id, label: tag.label })) : [];
  }, [outline.data]);

  // What is in the focus, so every focus can be finished.
  const totals = useMemo(() => {
    const ex = focusExercises(outline.data?.chapters.flatMap((c) => c.items) ?? [], state);
    return { done: ex.filter((e) => statusOf(state, e.id) === 'done').length, total: ex.length };
  }, [outline.data, state]);

  if (outline.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (outline.isError || !outline.data) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.serverGone}>{t.serverGoneBody}</Empty>
      </div>
    );
  }
  const o = outline.data;
  const updates = courses?.courses.some((c) => c.update === 'available');
  const showOutline = wide ? (inViewer ? viewerOutline : !collapsed) : false;
  const outlineHidden = !showOutline;

  const outlinePanel = (onNavigate?: () => void) => (
    <OutlinePanel outline={o} state={state} currentId={currentId} filters={filters} patch={patch} reset={reset} {...(onNavigate ? { onNavigate } : {})} />
  );

  return (
    <div className="flex h-full flex-col">
      <header className="wb-chrome-bar flex h-12 shrink-0 items-center gap-1 border-b border-line bg-sheet px-2 text-ink">
        {wide ? (
          <IconButton label={outlineHidden ? t.showOutline : t.hideOutline} onClick={toggleOutline}>
            {outlineHidden ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </IconButton>
        ) : (
          <IconButton label={t.openOutline} onClick={() => setDrawer(true)}>
            <Menu size={18} />
          </IconButton>
        )}
        <Link href="/" className="ml-1 truncate rounded-md px-2 py-1 text-[15px] font-semibold tracking-tight hover:bg-sunk">
          {o.title}
        </Link>
        <CourseMenu onCourses={() => setSwitching(true)} />
        {updates ? (
          <button type="button" onClick={() => setSwitching(true)} className="hidden shrink-0 items-center gap-1.5 rounded-full bg-review-soft px-2.5 py-0.5 text-xs font-medium text-review hover:opacity-80 sm:inline-flex">
            <span aria-hidden className="size-1.5 rounded-full bg-review" /> {t.updateAvailable}
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="hidden h-8 items-center gap-2 wb-field px-3 text-[13px] text-ink-3 sm:inline-flex"
          >
            <Search size={14} /> {t.search}
          </button>
          <IconButton label={t.search} className="sm:hidden" onClick={() => setSearching(true)}>
            <Search size={18} />
          </IconButton>
          <div className="mx-2 hidden items-center gap-2 text-[13px] text-ink-2 md:flex" title={t.exercisesDone}>
            <span className="tabular-nums">
              {totals.done}/{totals.total}
            </span>
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-sunk">
              <span className="block h-full rounded-full bg-done transition-[width]" style={{ width: `${totals.total ? (totals.done / totals.total) * 100 : 0}%` }} />
            </span>
          </div>
          {materialsOn ? (
            <Link
              href="/materials"
              className={clsx('inline-flex size-8 items-center justify-center rounded-md hover:bg-sunk hover:text-ink', location.startsWith('/materials') || location.startsWith('/library') ? 'bg-sunk text-ink' : 'text-ink-2')}
              aria-label={t.materials}
              aria-current={location.startsWith('/materials') ? 'page' : undefined}
              title={t.materials}
            >
              <Library size={18} />
            </Link>
          ) : null}
          {flashcardsOn ? <FlashcardsLink active={location.startsWith('/flashcards')} /> : null}
          <Link
            href="/notes"
            className={clsx('inline-flex size-8 items-center justify-center rounded-md hover:bg-sunk hover:text-ink', location === '/notes' ? 'bg-sunk text-ink' : 'text-ink-2')}
            aria-label={t.allNotes}
            aria-current={location === '/notes' ? 'page' : undefined}
            title={t.allNotes}
          >
            <NotebookText size={18} />
          </Link>
          <Link
            href="/questions"
            className={clsx('inline-flex size-8 items-center justify-center rounded-md hover:bg-sunk hover:text-ink', location === '/questions' ? 'bg-sunk text-ink' : 'text-ink-2')}
            aria-label={t.questionsTitle}
            aria-current={location === '/questions' ? 'page' : undefined}
            title={t.questionsTitle}
          >
            <MessageCircleQuestion size={18} />
          </Link>
          {annotationsOn ? (
            <Link
              href="/highlights"
              className={clsx('inline-flex size-8 items-center justify-center rounded-md hover:bg-sunk hover:text-ink', location === '/highlights' ? 'bg-sunk text-ink' : 'text-ink-2')}
              aria-label={t.highlights}
              aria-current={location === '/highlights' ? 'page' : undefined}
              title={t.highlights}
            >
              <Highlighter size={18} />
            </Link>
          ) : null}
          <Link href="/review" className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-sunk hover:text-ink" aria-label={t.review} title={t.review}>
            <ClipboardList size={18} />
          </Link>
          {/* The meadow is worth coming back to, so it is one click away from anywhere. */}
          {achievementsOn ? (
            <Link
              href="/achievements"
              className={clsx('inline-flex size-8 items-center justify-center rounded-md hover:bg-sunk hover:text-ink', location === '/achievements' ? 'bg-sunk text-ink' : 'text-ink-2')}
              aria-label={t.achievementsAndFriends}
              aria-current={location === '/achievements' ? 'page' : undefined}
              title={t.achievementsAndFriends}
            >
              {rewardIcon === 'paw' ? <PawPrint size={18} /> : <Trophy size={18} />}
            </Link>
          ) : null}
          <Link
            href="/help"
            className={clsx('inline-flex size-8 items-center justify-center rounded-md hover:bg-sunk hover:text-ink', location.startsWith('/help') ? 'bg-sunk text-ink' : 'text-ink-2')}
            aria-label={t.help}
            aria-current={location.startsWith('/help') ? 'page' : undefined}
            title={t.help}
          >
            <CircleHelp size={18} />
          </Link>
          <QuickSettings />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {showOutline ? <aside className="w-[19rem] shrink-0 border-r border-line">{outlinePanel()}</aside> : null}
        <main className="min-w-0 flex-1">
          <CoursePages />
        </main>
      </div>

      {drawer && !wide ? (
        <div className="fixed inset-0 z-30 flex" role="dialog" aria-label={t.outline}>
          <div className="w-[min(22rem,88vw)] border-r border-line bg-sheet shadow-[var(--shadow)]">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="font-semibold">{t.outline}</span>
              <IconButton label={t.closeOutline} onClick={() => setDrawer(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <div className={clsx('h-[calc(100%-3rem)]')}>{outlinePanel(closeDrawer)}</div>
          </div>
          <button type="button" aria-label={t.closeOutline} className="flex-1 bg-ink/30" onClick={() => setDrawer(false)} />
        </div>
      ) : null}

      <SearchDialog open={searching} onClose={() => setSearching(false)} />
      <AnnotationLayer />
      <PdfRefPicker />
      {achievementsOn ? <Celebration /> : null}
      <CourseDialog open={switching} onClose={() => setSwitching(false)} />
      <SetupDialog />
      <FocusQuestion />
      <QuestionPopup />
    </div>
  );
}

/** The page in the main area. Memoized without props: the shell re-renders for its own reasons (a dialog, the drawer) without drawing the page again. */
const CoursePages = memo(function CoursePages() {
  const t = useT();
  return (
    // No spinner while a page loads: it is local and usually loaded already, a spinner would only flash.
    <Suspense>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/item/:id">{(p) => <ItemPage id={p.id} />}</Route>
        <Route path="/item/:id/in/:group">{(p) => <ItemPage id={p.id} group={decodeURIComponent(p.group)} />}</Route>
        <Route path="/review" component={ReviewPage} />
        <Route path="/settings">{() => <SettingsPage />}</Route>
        <Route path="/settings/:section">{(p) => <SettingsPage section={p.section} />}</Route>
        <Route path="/welcome" component={LandingPage} />
        <Route path="/achievements" component={AchievementsPage} />
        <Route path="/notes" component={NotesPage} />
        <Route path="/questions" component={QuestionsPage} />
        <Route path="/highlights">{() => <HighlightsPage />}</Route>
        <Route path="/materials" component={MaterialsPage} />
        <Route path="/highlights/:filter">{(p) => <HighlightsPage key={p.filter} filter={p.filter} />}</Route>
        {flashcardRoutes()}
        <Route path="/chapter/:id">{(p) => <ChapterPage key={p.id} id={p.id} />}</Route>
        <Route path="/kind/:kind">{(p) => (THREAD_KINDS.includes(p.kind as ThreadKind) ? <KindPage key={p.kind} kind={p.kind as ThreadKind} /> : null)}</Route>
        <Route path="/adventure/:id">{(p) => <AdventurePage key={p.id} id={p.id} />}</Route>
        <Route>
          <Empty title={t.pageNotFound}>{t.pageNotFoundBody}</Empty>
        </Route>
      </Switch>
    </Suspense>
  );
});

/** A dot when cards wait. Only a dot: a number of cards owed would read as a debt. */
function FlashcardsLink({ active }: { active: boolean }) {
  const t = useT();
  const decks = useFlashcards().data?.decks;
  const waiting = decks?.some((d) => d.due > 0) ?? false;
  return (
    <Link
      href="/flashcards"
      className={clsx('relative inline-flex size-8 items-center justify-center rounded-md hover:bg-sunk hover:text-ink', active ? 'bg-sunk text-ink' : 'text-ink-2')}
      aria-label={t.flashcards}
      aria-current={active ? 'page' : undefined}
      title={t.flashcards}
    >
      <Layers size={18} />
      {waiting ? <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" /> : null}
    </Link>
  );
}

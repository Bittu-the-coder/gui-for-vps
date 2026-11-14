import {
  LESSONS,
  SKILL_LEVELS,
  doStepDone,
  lessonPercent,
  lessonsByLevel,
  shuffledQuiz,
  type Lesson,
  type LessonStep,
  type SkillLevel,
} from '@gfv/shared';
import { CircleCheck, GraduationCap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { openApp } from '../../desktop/openApp';
import { usePolling } from '../../hooks/usePolling';
import { requestRun } from '../../runner/runStore';
import { useLearn } from '../../stores/learnStore';
import { useLessons } from '../../stores/lessonStore';
import { useServers } from '../../stores/serverStore';
import { useSkill } from '../../stores/skillStore';
import { appById } from '../registry';

const LEVEL_LABEL: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  expert: 'Expert',
};
const LEVEL_HELP: Record<SkillLevel, string> = {
  beginner: 'Everything explained: the Learn panel is open and each action shows what it does.',
  intermediate: 'The Learn panel stays; explanations are folded away until you open them.',
  expert: 'Fewer prompts: the Learn panel starts closed. Safety confirmations never change.',
};

function Quiz({
  step,
  onSolved,
}: {
  step: Extract<LessonStep, { type: 'quiz' }>;
  onSolved: () => void;
}) {
  const q = useMemo(() => shuffledQuiz(step), [step]);
  const [picked, setPicked] = useState<number | null>(null);
  const solved = picked === q.answer;
  return (
    <div>
      <p className="mb-2 font-medium">{step.question}</p>
      <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label={step.question}>
        {q.options.map((o, i) => {
          const wrong = picked === i && i !== q.answer;
          return (
            <li key={o}>
              <button
                role="radio"
                aria-checked={picked === i}
                disabled={solved}
                onClick={() => setPicked(i)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-body ${
                  solved && i === q.answer
                    ? 'border-success bg-success/10'
                    : wrong
                      ? 'border-danger bg-danger/10'
                      : 'border-separator hover:bg-accent'
                }`}
              >
                {o}
              </button>
            </li>
          );
        })}
      </ul>
      {picked !== null && (
        <p role="status" className={`mt-2 text-body ${solved ? 'text-success' : 'text-danger'}`}>
          {solved
            ? `Correct. ${step.explain}`
            : 'Not quite. Think about what each command actually does, then try again.'}
        </p>
      )}
      {solved && (
        <Button className="mt-3" onClick={onSolved}>
          Continue
        </Button>
      )}
    </div>
  );
}

function Player({ lesson, onClose }: { lesson: Lesson; onClose: () => void }) {
  const { progress, start, setStep, complete, reset } = useLessons();
  const entries = useLearn((s) => s.entries);
  const refresh = useLearn((s) => s.refresh);
  const activeId = useServers((s) => s.activeId);
  const p = progress[lesson.id];
  const step = p ? lesson.steps[Math.min(p.step, lesson.steps.length - 1)]! : undefined;

  useEffect(() => start(lesson.id), [lesson.id, start]);
  // "Do it" steps finish when the action shows up in your history: poll it while waiting.
  usePolling(refresh, 2000, step?.type === 'do');
  const done = step?.type === 'do' && p ? doStepDone(step, entries, p.startedAt) : false;
  const next = () => {
    if (!p) return;
    if (p.step + 1 >= lesson.steps.length) complete(lesson.id);
    else setStep(lesson.id, p.step + 1);
  };

  if (!p) return null;
  const finished = !!p.completedAt;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          ← Lessons
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-title font-semibold">{lesson.title}</h2>
        <span className="text-footnote text-muted-foreground">
          {finished
            ? 'Done'
            : `Step ${Math.min(p.step + 1, lesson.steps.length)} of ${lesson.steps.length}`}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div
          role="progressbar"
          aria-label="Lesson progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={lessonPercent(lesson, p)}
          className="mb-4 h-1.5 overflow-hidden rounded-full bg-foreground/10"
        >
          <div className="h-full bg-primary" style={{ width: `${lessonPercent(lesson, p)}%` }} />
        </div>

        {finished ? (
          <div className="text-center" data-testid="lesson-complete">
            <CircleCheck size={40} className="mx-auto text-success" />
            <p className="mt-2 text-title font-semibold">Lesson complete</p>
            <p className="mt-1 text-muted-foreground">{lesson.summary}</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={onClose}>Back to lessons</Button>
              <Button variant="outline" onClick={() => reset(lesson.id)}>
                Do it again
              </Button>
            </div>
          </div>
        ) : (
          step && (
            <div key={p.step}>
              <p className="text-caption font-semibold uppercase tracking-wide text-faint-foreground">
                {step.title}
              </p>
              {step.type === 'read' && (
                <>
                  <p className="mt-2 text-body">{step.body}</p>
                  <Button className="mt-4" onClick={next}>
                    Continue
                  </Button>
                </>
              )}
              {step.type === 'quiz' && <Quiz step={step} onSolved={next} />}
              {step.type === 'do' && (
                <>
                  <p className="mt-2 text-body">{step.body}</p>
                  {!activeId && (
                    <p role="alert" className="mt-2 text-body text-danger">
                      Pick a server in the menu bar first: lessons run on a real one.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {step.app && (
                      <Button variant="outline" onClick={() => openApp(appById(step.app!)!)}>
                        Open {appById(step.app)?.title}
                      </Button>
                    )}
                    {step.runForMe && activeId && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          requestRun({
                            serverId: activeId,
                            actionId: step.actionId,
                            params: step.runForMe!.params,
                          })
                        }
                      >
                        {step.runForMe.label}
                      </Button>
                    )}
                    {done ? (
                      <>
                        <span
                          role="status"
                          className="flex items-center gap-1 text-body text-success"
                        >
                          <CircleCheck size={16} /> You did it.
                        </span>
                        <Button onClick={next}>Continue</Button>
                      </>
                    ) : (
                      <span className="text-footnote text-muted-foreground">
                        Waiting for you to do it…
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** Guided lessons that use a real server, with quizzes and a skill level that dials down the hand-holding. */
export function LessonsApp() {
  const { level, setLevel } = useSkill();
  const progress = useLessons((s) => s.progress);
  const [open, setOpen] = useState<string | null>(null);
  const groups = lessonsByLevel(LESSONS);
  const lesson = LESSONS.find((l) => l.id === open);

  return (
    <div className="flex h-full flex-col text-body">
      {lesson ? (
        <Player lesson={lesson} onClose={() => setOpen(null)} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mb-4 rounded-xl border border-separator p-3">
            <p className="flex items-center gap-2 font-medium">
              <GraduationCap size={16} className="text-link" /> Your skill level
            </p>
            <div role="radiogroup" aria-label="Skill level" className="mt-2 flex gap-1">
              {SKILL_LEVELS.map((l) => (
                <Button
                  key={l}
                  role="radio"
                  aria-checked={level === l}
                  size="sm"
                  variant={level === l ? 'default' : 'outline'}
                  onClick={() => setLevel(l)}
                >
                  {LEVEL_LABEL[l]}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-footnote text-muted-foreground">{LEVEL_HELP[level]}</p>
          </div>
          {SKILL_LEVELS.map((l) =>
            groups[l].length === 0 ? null : (
              <section key={l} className="mb-4" aria-label={`${LEVEL_LABEL[l]} lessons`}>
                <h2 className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-faint-foreground">
                  {LEVEL_LABEL[l]}
                </h2>
                <ul className="flex flex-col gap-2">
                  {groups[l].map((ls) => {
                    const pct = lessonPercent(ls, progress[ls.id]);
                    return (
                      <li key={ls.id}>
                        <button
                          data-testid="lesson-card"
                          onClick={() => setOpen(ls.id)}
                          className="w-full rounded-xl border border-separator bg-background p-3 text-left hover:bg-accent"
                        >
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{ls.title}</span>
                            {pct === 100 && (
                              <CircleCheck
                                size={15}
                                className="text-success"
                                aria-label="Completed"
                              />
                            )}
                            <span className="ml-auto text-footnote text-muted-foreground">
                              {ls.minutes} min · {ls.steps.length} steps
                            </span>
                          </span>
                          <span className="block text-footnote text-muted-foreground">
                            {ls.summary}
                          </span>
                          {pct > 0 && pct < 100 && (
                            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-foreground/10">
                              <span
                                className="block h-full bg-primary"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}

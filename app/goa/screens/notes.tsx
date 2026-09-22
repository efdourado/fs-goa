"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { KebabMenu, menuRowClass } from "../card-menu";
import { useCsrf } from "../csrf";
import { ConfirmDialog, FormDialog } from "../dialog";
import { useGoaFormat } from "../format";
import { ColorSwatch } from "./dashboard";
import { CHALLENGE_COLOR_TAGS, type ChallengeColorTag, type Note, type NoteItem } from "../types";
import { BackButton, Button, cardClass, CirclePinIcon, cx, EmptyState, Field, inputClass, PageHeading, StatusMessage, Toggle } from "../ui";

const icon = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const NoteGlyph = () => <svg viewBox="0 0 16 16" className="h-4 w-4" {...icon}><path d="M3.5 2.5h9v11h-9z" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" /></svg>;
const ChecklistGlyph = () => <svg viewBox="0 0 16 16" className="h-4 w-4" {...icon}><path d="M3 4.5l1.2 1.2L6 3.7" /><path d="M8 4.3h5" /><path d="M3 8.5l1.2 1.2L6 7.7" /><path d="M8 8.3h5" /><path d="M3 12.5l1.2 1.2L6 11.7" /><path d="M8 12.3h5" /></svg>;

/**
 * A small text/checklist item row for the editor — a live-editable list with its own add/remove, no
 * dialog. Only `text` is ever touched here; each item's `done` rides along untouched (checking one off
 * happens from the card, not this editor, and a title/wording edit must never reset that progress).
 */
function ChecklistEditor({ items, onChange, addLabel, removeLabel }: {
  items: NoteItem[];
  onChange: (next: NoteItem[]) => void;
  addLabel: string;
  removeLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={item.id} className="flex items-center gap-2">
          <input
            className={inputClass}
            value={item.text}
            maxLength={300}
            onChange={(event) => onChange(items.map((entry, i) => (i === index ? { ...entry, text: event.target.value } : entry)))}
          />
          <button
            type="button"
            aria-label={removeLabel}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
            className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--danger)]"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" {...icon}><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { id: `new-${items.length}-${Date.now().toString(36)}`, text: "", done: false }])}
        className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--line)] px-3.5 text-sm text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
      >
        + {addLabel}
      </button>
    </div>
  );
}

/** Create a note, or edit one — `note` present picks the mode; its `kind` is fixed once made. */
function NoteEditorDialog({ note, onCancel, onSaved }: { note: Note | null; onCancel: () => void; onSaved: (note: Note) => void }) {
  const t = useTranslations("notes");
  const tc = useTranslations("common");
  const td = useTranslations("dashboard");
  const f = useGoaFormat();
  const csrf = useCsrf();
  const [kind, setKind] = useState<"text" | "checklist">(note?.kind ?? "text");
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [items, setItems] = useState<NoteItem[]>(note?.items ?? []);
  const [colorTag, setColorTag] = useState<ChallengeColorTag | null>(note?.colorTag ?? null);
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = note
    ? title !== note.title || body !== (note.body ?? "") || colorTag !== note.colorTag || pinned !== note.pinned
      || JSON.stringify(items) !== JSON.stringify(note.items)
    : Boolean(title.trim() || body.trim() || items.some((item) => item.text.trim()));

  async function submit() {
    const name = title.trim();
    if (!name) { setError(t("titleRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      const payload = note
        ? { title: name, ...(kind === "text" ? { body } : { items }), colorTag, pinned }
        : { kind, title: name, body: kind === "text" ? body : undefined, items: kind === "checklist" ? items : undefined, colorTag, pinned };
      const saved = note
        ? await apiRequest<Note>(API_PATHS.note(note.id), { method: "PATCH", body: payload, csrfToken: csrf })
        : await apiRequest<Note>(API_PATHS.notes, { method: "POST", body: payload, csrfToken: csrf });
      onSaved(saved);
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <FormDialog
      title={note ? t("editTitle") : t("newTitle")}
      dirty={dirty}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      submitLabel={note ? tc("save") : t("create")}
    >
      {!note ? (
        <Field label="" plain>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(["text", "checklist"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
                className={cx(
                  "flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition",
                  kind === option ? "border-[var(--main)] bg-[var(--main-soft)] ring-[3px] ring-[var(--main)]/12" : "border-[var(--line)] hover:border-[var(--main-line)]",
                )}
              >
                <strong className={cx("text-[13.5px] font-medium", kind === option && "text-[var(--main-strong)]")}>{option === "text" ? t("kindText") : t("kindChecklist")}</strong>
                <span className="text-[11.5px] text-[var(--muted)]">{option === "text" ? t("kindTextHint") : t("kindChecklistHint")}</span>
              </button>
            ))}
          </div>
        </Field>
      ) : null}
      <Field label={t("titleLabel")}>
        <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder={t("titlePlaceholder")} />
      </Field>
      {kind === "text" ? (
        <Field label={t("bodyLabel")} optional>
          <textarea className={inputClass} rows={8} value={body} maxLength={20000} onChange={(event) => setBody(event.target.value)} />
        </Field>
      ) : (
        <Field label={t("itemsLabel")} plain>
          <ChecklistEditor items={items} onChange={setItems} addLabel={t("addItem")} removeLabel={t("removeItem")} />
        </Field>
      )}
      <Field label={t("colorLabel")} plain>
        <div className="flex flex-wrap items-center gap-2">
          <ColorSwatch tag={null} label={td("color.none")} selected={colorTag === null} onClick={() => setColorTag(null)} />
          {CHALLENGE_COLOR_TAGS.map((tag) => (
            <ColorSwatch key={tag} tag={tag} label={td(`color.${tag}`)} selected={colorTag === tag} onClick={() => setColorTag(tag)} />
          ))}
        </div>
      </Field>
      <Toggle checked={pinned} onChange={setPinned} label={t("pinnedLabel")} />
    </FormDialog>
  );
}

function NoteCard({ note, onEdit, onDelete, onTogglePin, onToggleItem }: {
  note: Note;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onToggleItem: (item: NoteItem) => void;
}) {
  const t = useTranslations("notes");
  const f = useGoaFormat();
  const VISIBLE_ITEMS = 6;
  const done = note.items.filter((item) => item.done).length;
  return (
    <article className={cx(cardClass, "group relative flex flex-col overflow-hidden p-5")}>
      {note.colorTag ? <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: `var(--tag-${note.colorTag})` }} aria-hidden="true" /> : null}
      <div className={cx("flex items-start justify-between gap-2", note.colorTag && "pl-1")}>
        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[var(--wash)] text-[var(--muted)]" aria-hidden="true">
          {note.kind === "checklist" ? <ChecklistGlyph /> : <NoteGlyph />}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={note.pinned ? t("unpin") : t("pin")}
          title={note.pinned ? t("unpin") : t("pin")}
          aria-pressed={note.pinned}
          className={cx(
            "grid h-7 w-7 flex-none place-items-center rounded-full transition",
            note.pinned ? "text-[var(--main)] opacity-100" : "text-[var(--muted)] opacity-0 hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          <CirclePinIcon className="h-[18px] w-[18px]" filled={note.pinned} />
        </button>
        <KebabMenu label={t("noteActions")}>
          {(close) => (
            <>
              <button type="button" className={menuRowClass} onClick={() => { onEdit(); close(); }}>{t("edit")}</button>
              <button type="button" className={cx(menuRowClass, "text-[var(--danger)]")} onClick={() => { onDelete(); close(); }}>{t("delete")}</button>
            </>
          )}
        </KebabMenu>
      </div>

      <button type="button" onClick={onEdit} className={cx("mt-2 cursor-pointer text-left", note.colorTag && "pl-1")}>
        <h3 className="text-base font-medium leading-snug tracking-[-0.01em]">{note.title}</h3>
      </button>

      <div className={cx("mt-2.5 min-h-0 flex-1", note.colorTag && "pl-1")}>
        {note.kind === "text" ? (
          note.body ? <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{note.body}</p> : null
        ) : (
          <ul className="space-y-1.5">
            {note.items.slice(0, VISIBLE_ITEMS).map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-2 text-sm leading-5">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(event) => onToggleItem({ ...item, done: event.target.checked })}
                    className="mt-0.5 h-4 w-4 flex-none accent-[var(--main)]"
                  />
                  <span className={cx("min-w-0 break-words", item.done && "text-[var(--muted)] line-through")}>{item.text}</span>
                </label>
              </li>
            ))}
            {note.items.length > VISIBLE_ITEMS ? (
              <li className="pl-6 text-xs text-[var(--muted)]">{t("moreItems", { count: note.items.length - VISIBLE_ITEMS })}</li>
            ) : null}
          </ul>
        )}
      </div>

      <div className={cx("mt-3 flex items-center justify-between gap-2 text-xs text-[var(--muted)]", note.colorTag && "pl-1")}>
        <span>{t("updated", { date: f.date(note.updatedAt) })}</span>
        {note.kind === "checklist" && note.items.length ? <span>{t("itemsDone", { done, total: note.items.length })}</span> : null}
      </div>
    </article>
  );
}

/**
 * A private space for whatever doesn't need a group or a challenge yet — an idea, a to-do list, a thought
 * worth keeping somewhere prettier than the phone's own notes app. Nothing here links to a challenge; when
 * one of these is ready to become real, Home is one tap away.
 */
export function NotesScreen({ onBack, backLabel }: { onBack: () => void; backLabel?: string }) {
  const t = useTranslations("notes");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const csrf = useCsrf();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"new" | Note | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ notes: Note[] }>(API_PATHS.notes, { signal: controller.signal })
      .then((response) => setNotes(response.notes))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setNotes((current) => current ?? []);
        setError(f.error(cause));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function replace(updated: Note) {
    setNotes((current) => {
      const rest = (current ?? []).filter((note) => note.id !== updated.id);
      return [...rest, updated].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
    });
  }

  async function togglePin(note: Note) {
    const updated = await apiRequest<Note>(API_PATHS.note(note.id), { method: "PATCH", body: { pinned: !note.pinned }, csrfToken: csrf });
    replace(updated);
  }

  async function toggleItem(note: Note, item: NoteItem) {
    const updated = await apiRequest<Note>(API_PATHS.noteToggle(note.id), { method: "POST", body: { itemId: item.id, done: item.done }, csrfToken: csrf });
    replace(updated);
  }

  async function confirmDelete(note: Note) {
    await apiRequest(API_PATHS.note(note.id), { method: "DELETE", csrfToken: csrf });
    setNotes((current) => (current ?? []).filter((entry) => entry.id !== note.id));
    setNotice(t("deletedNotice"));
    setDeleting(null);
  }

  const loading = notes === null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="mb-6" />
      <PageHeading
        title={t("title")}
        description={t("subtitle")}
        action={<Button onClick={() => { setNotice(null); setDialog("new"); }}>＋ {t("newNote")}</Button>}
      />

      <StatusMessage error={error} success={notice} />

      {loading ? (
        <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
      ) : notes.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onEdit={() => setDialog(note)}
              onDelete={() => setDeleting(note)}
              onTogglePin={() => void togglePin(note)}
              onToggleItem={(item) => void toggleItem(note, item)}
            />
          ))}
        </div>
      ) : (
        <EmptyState title={t("emptyTitle")} hint={t("emptyHint")} onClick={() => setDialog("new")} />
      )}

      {dialog ? (
        <NoteEditorDialog
          note={dialog === "new" ? null : dialog}
          onCancel={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            setNotice(dialog === "new" ? t("createdNotice") : t("savedNotice"));
            replace(saved);
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={t("deleteTitle", { title: deleting.title })}
          body={t("deleteBody")}
          confirmLabel={t("deleteConfirm")}
          busyLabel={tc("saving")}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => confirmDelete(deleting)}
        />
      ) : null}
    </main>
  );
}

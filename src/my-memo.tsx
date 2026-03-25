import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  LaunchType,
  launchCommand,
  open,
  showToast,
  Toast,
} from "@raycast/api";
import { useSQL } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";

import { getDayRange } from "./date";
import { normalizeMemoForSave, renderMemoMarkdown } from "./memo-markdown";
import {
  appendSharedNoteHistory,
  ensurePlannerDataFile,
  ensurePlannerStorageReady,
  getPlannerDatabasePath,
  saveSharedNote,
} from "./storage";

type SqliteValueRow = {
  value_json: string;
};

const NOTES_BY_DAY_KEY = "planner.notes-by-day.v1";

const Command = () => {
  const { dayKey, label } = getDayRange(new Date());
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [previewNote, setPreviewNote] = useState("");
  const [isShowingPreview, setIsShowingPreview] = useState(false);
  const noteRef = useRef("");
  const openPlannerFile = () => void ensurePlannerDataFile().then(open);
  const noteSql = useSQL<SqliteValueRow>(
    getPlannerDatabasePath(),
    `SELECT value_json FROM planner_kv WHERE key = '${NOTES_BY_DAY_KEY}' LIMIT 1`,
    { execute: isStorageReady },
  );
  let savedNote = "";
  try {
    savedNote =
      (
        JSON.parse(noteSql.data?.[0]?.value_json ?? "{}") as Record<
          string,
          string
        >
      )[dayKey] ?? "";
  } catch {}

  useEffect(() => {
    void ensurePlannerStorageReady().then(() => {
      setIsStorageReady(true);
    });
  }, []);

  useEffect(() => {
    noteRef.current = savedNote;
    setPreviewNote(savedNote);
  }, [savedNote]);

  if (noteSql.permissionView) {
    return noteSql.permissionView;
  }

  if (isShowingPreview) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action
              title="編集に戻る"
              icon={Icon.Pencil}
              shortcut={{ modifiers: ["cmd"], key: "e" }}
              onAction={() => setIsShowingPreview(false)}
            />
            <Action
              title="planner.md を開く"
              icon={Icon.Finder}
              onAction={openPlannerFile}
            />
          </ActionPanel>
        }
        markdown={renderMemoMarkdown(previewNote)}
        navigationTitle={`${label} のメモプレビュー`}
      />
    );
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="保存"
            icon={Icon.Checkmark}
            shortcut={{ modifiers: ["cmd"], key: "s" }}
            onSubmit={(values) =>
              void saveSharedMemo(
                noteSql.mutate,
                dayKey,
                savedNote,
                values.memo,
                setPreviewNote,
              )
            }
          />
          <Action
            title="プレビュー"
            icon={Icon.Eye}
            shortcut={{ modifiers: ["cmd", "shift"], key: "v" }}
            onAction={() => {
              setPreviewNote(noteRef.current);
              setIsShowingPreview(true);
            }}
          />
          <Action
            title="planner.md を開く"
            icon={Icon.Finder}
            onAction={openPlannerFile}
          />
        </ActionPanel>
      }
      isLoading={!isStorageReady || noteSql.isLoading}
      navigationTitle={`${label} のメモ`}
    >
      {isStorageReady && !noteSql.isLoading ? (
        <Form.TextArea
          defaultValue={savedNote}
          enableMarkdown
          id="memo"
          title="メモ"
          onChange={(value) => {
            noteRef.current = value;
          }}
        />
      ) : null}
    </Form>
  );
};

export default Command;

const saveSharedMemo = async (
  mutate: ReturnType<typeof useSQL<SqliteValueRow>>["mutate"],
  dayKey: string,
  previousNote: string,
  nextNote: string,
  setPreviewNote: (note: string) => void,
) => {
  const normalizedNote = await normalizeMemoForSave(nextNote);
  await mutate(
    (async () => {
      await saveSharedNote(dayKey, normalizedNote);
      await appendSharedNoteHistory({
        after: normalizedNote,
        before: previousNote,
        dayKey,
        timestamp: new Date().toISOString(),
      });
    })(),
  );
  setPreviewNote(normalizedNote);
  await showToast({
    style: Toast.Style.Success,
    title: "メモを保存しました",
  });
  await launchCommand({
    name: "my-schedule",
    type: LaunchType.UserInitiated,
  });
};

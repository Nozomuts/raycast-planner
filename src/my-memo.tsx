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
import { useEffect, useRef, useState } from "react";

import { getDayRange } from "./date";
import { normalizeMemoForSave, renderMemoMarkdown } from "./memo-markdown";
import {
  appendSharedNoteHistory,
  ensurePlannerDataFile,
  loadSharedNote,
  saveSharedNote,
} from "./storage";

const Command = () => {
  const { dayKey, label } = getDayRange(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [savedNote, setSavedNote] = useState("");
  const [previewNote, setPreviewNote] = useState("");
  const [isShowingPreview, setIsShowingPreview] = useState(false);
  const noteRef = useRef("");
  const openPlannerFile = () => void ensurePlannerDataFile().then(open);

  useEffect(() => {
    void loadSharedMemo(dayKey).then((value) => {
      setSavedNote(value);
      setPreviewNote(value);
      noteRef.current = value;
      setIsLoading(false);
    });
  }, [dayKey]);

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
                dayKey,
                savedNote,
                values.memo,
                setSavedNote,
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
      isLoading={isLoading}
      navigationTitle={`${label} のメモ`}
    >
      {!isLoading ? (
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

const loadSharedMemo = async (dayKey: string) => await loadSharedNote(dayKey);

const saveSharedMemo = async (
  dayKey: string,
  previousNote: string,
  nextNote: string,
  onSaved: (note: string) => void,
  setPreviewNote: (note: string) => void,
) => {
  const normalizedNote = await normalizeMemoForSave(nextNote);
  await saveSharedNote(dayKey, normalizedNote);
  await appendSharedNoteHistory({
    after: normalizedNote,
    before: previousNote,
    dayKey,
    timestamp: new Date().toISOString(),
  });
  onSaved(normalizedNote);
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

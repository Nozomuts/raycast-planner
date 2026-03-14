import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  LaunchType,
  launchCommand,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";

import { getDayRange } from "./date";
import { normalizeMemoForSave, renderMemoMarkdown } from "./memo-markdown";
import {
  appendSharedNoteHistory,
  loadSharedNote,
  saveSharedNote,
} from "./storage";

const Command = () => {
  const { dayKey, label } = getDayRange(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [isShowingPreview, setIsShowingPreview] = useState(false);

  useEffect(() => {
    void loadSharedMemo(dayKey).then((value) => {
      setNote(value);
      setSavedNote(value);
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
          </ActionPanel>
        }
        markdown={renderMemoMarkdown(note)}
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
            onSubmit={() =>
              void saveSharedMemo(dayKey, savedNote, note, setSavedNote)
            }
          />
          <Action
            title="プレビュー"
            icon={Icon.Eye}
            shortcut={{ modifiers: ["cmd", "shift"], key: "v" }}
            onAction={() => setIsShowingPreview(true)}
          />
        </ActionPanel>
      }
      isLoading={isLoading}
      navigationTitle={`${label} のメモ`}
    >
      <Form.TextArea id="memo" title="メモ" value={note} onChange={setNote} />
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
  await showToast({
    style: Toast.Style.Success,
    title: "メモを保存しました",
  });
  await launchCommand({
    name: "my-schedule",
    type: LaunchType.UserInitiated,
  });
};

import React, { KeyboardEventHandler, useCallback, useEffect, useState } from 'react';
import { Box, Chip, Icon, IconButton, Icons, Line, PopOut, Spinner, Text, as, config } from 'folds';
import { Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { IContent, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import isHotkey from 'is-hotkey';
import {
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  AutocompleteQuery,
  CustomEditor,
  EmoticonAutocomplete,
  RoomMentionAutocomplete,
  Toolbar,
  UserMentionAutocomplete,
  createEmoticonElement,
  customHtmlEqualsPlainText,
  getAutocompleteQuery,
  getPrevWorldRange,
  htmlToEditorInput,
  moveCursor,
  plainToEditorInput,
  toMatrixCustomHTML,
  toPlainText,
  trimCustomHtml,
  useEditor,
} from '../../../components/editor';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { UseStateProvider } from '../../../components/UseStateProvider';
import { EmojiBoard } from '../../../components/emoji-board';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getEditedEvent } from '../../../utils/room';

type MessageEditorProps = {
  roomId: string;
  room: Room;
  mEvent: MatrixEvent;
  imagePackRooms?: Room[];
  onCancel: () => void;
};
export const MessageEditor = as<'div', MessageEditorProps>(
  ({ room, roomId, mEvent, imagePackRooms, onCancel, ...props }, ref) => {
    const mx = useMatrixClient();
    const editor = useEditor();
    const [globalToolbar] = useSetting(settingsAtom, 'editorToolbar');
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const [toolbar, setToolbar] = useState(globalToolbar);

    const [autocompleteQuery, setAutocompleteQuery] =
      useState<AutocompleteQuery<AutocompletePrefix>>();

    const [saveState, save] = useAsyncCallback(
      useCallback(async () => {
        const plainText = toPlainText(editor.children).trim();
        const customHtml = trimCustomHtml(
          toMatrixCustomHTML(editor.children, {
            allowTextFormatting: true,
            allowMarkdown: isMarkdown,
          })
        );

        if (plainText === '') return undefined;

        const newContent: IContent = {
          msgtype: mEvent.getContent().msgtype,
          body: plainText,
        };

        if (!customHtmlEqualsPlainText(customHtml, plainText)) {
          newContent.format = 'org.matrix.custom.html';
          newContent.formatted_body = customHtml;
        }

        const content: IContent = {
          ...newContent,
          body: `* ${plainText}`,
          'm.new_content': newContent,
          'm.relates_to': {
            event_id: mEvent.getId(),
            rel_type: RelationType.Replace,
          },
        };

        return mx.sendMessage(roomId, content);
      }, [mx, editor, roomId, mEvent, isMarkdown])
    );

    const handleKeyDown: KeyboardEventHandler = useCallback(
      (evt) => {
        if (isHotkey('enter', evt)) {
          evt.preventDefault();
          save();
        }
        if (isHotkey('escape', evt)) {
          evt.preventDefault();
          onCancel();
        }
      },
      [onCancel, save]
    );

    const handleKeyUp: KeyboardEventHandler = useCallback(() => {
      const prevWordRange = getPrevWorldRange(editor);
      const query = prevWordRange
        ? getAutocompleteQuery<AutocompletePrefix>(editor, prevWordRange, AUTOCOMPLETE_PREFIXES)
        : undefined;
      setAutocompleteQuery(query);
    }, [editor]);

    const handleEmoticonSelect = (key: string, shortcode: string) => {
      editor.insertNode(createEmoticonElement(key, shortcode));
      moveCursor(editor);
    };

    useEffect(() => {
      const evtId = mEvent.getId()!;
      const evtTimeline = room.getTimelineForEvent(evtId);
      const editedEvent =
        evtTimeline && getEditedEvent(evtId, mEvent, evtTimeline.getTimelineSet());

      const { body, formatted_body: customHtml }: Record<string, unknown> =
        editedEvent?.getContent()['m.new.content'] ?? mEvent.getContent();

      const initialValue =
        typeof customHtml === 'string'
          ? htmlToEditorInput(customHtml)
          : plainToEditorInput(typeof body === 'string' ? body : '');

      Transforms.select(editor, {
        anchor: Editor.start(editor, []),
        focus: Editor.end(editor, []),
      });

      editor.insertFragment(initialValue);
      ReactEditor.focus(editor);
    }, [editor, room, mEvent]);

    useEffect(() => {
      if (saveState.status === AsyncStatus.Success) {
        onCancel();
      }
    }, [saveState, onCancel]);

    return (
      <div {...props} ref={ref}>
        {autocompleteQuery?.prefix === AutocompletePrefix.RoomMention && (
          <RoomMentionAutocomplete
            roomId={roomId}
            editor={editor}
            query={autocompleteQuery}
            requestClose={() => setAutocompleteQuery(undefined)}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.UserMention && (
          <UserMentionAutocomplete
            roomId={roomId}
            editor={editor}
            query={autocompleteQuery}
            requestClose={() => setAutocompleteQuery(undefined)}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.Emoticon && (
          <EmoticonAutocomplete
            imagePackRooms={imagePackRooms || []}
            editor={editor}
            query={autocompleteQuery}
            requestClose={() => setAutocompleteQuery(undefined)}
          />
        )}
        <CustomEditor
          editor={editor}
          placeholder="Edit message..."
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          bottom={
            <>
              <Box
                style={{ padding: config.space.S200, paddingTop: 0 }}
                alignItems="End"
                justifyContent="SpaceBetween"
                gap="100"
              >
                <Box gap="Inherit">
                  <Chip
                    onClick={save}
                    variant="Primary"
                    radii="Pill"
                    disabled={saveState.status === AsyncStatus.Loading}
                    outlined
                    before={
                      saveState.status === AsyncStatus.Loading ? (
                        <Spinner variant="Primary" fill="Soft" size="100" />
                      ) : undefined
                    }
                  >
                    <Text size="B300">Save</Text>
                  </Chip>
                  <Chip onClick={onCancel} variant="SurfaceVariant" radii="Pill">
                    <Text size="B300">Cancel</Text>
                  </Chip>
                </Box>
                <Box gap="Inherit">
                  <IconButton
                    variant="SurfaceVariant"
                    size="300"
                    radii="300"
                    onClick={() => setToolbar(!toolbar)}
                  >
                    <Icon size="400" src={toolbar ? Icons.AlphabetUnderline : Icons.Alphabet} />
                  </IconButton>
                  <UseStateProvider initial={false}>
                    {(emojiBoard: boolean, setEmojiBoard) => (
                      <PopOut
                        alignOffset={-8}
                        position="Top"
                        align="End"
                        open={!!emojiBoard}
                        content={
                          <EmojiBoard
                            imagePackRooms={imagePackRooms ?? []}
                            returnFocusOnDeactivate={false}
                            onEmojiSelect={handleEmoticonSelect}
                            onCustomEmojiSelect={handleEmoticonSelect}
                            requestClose={() => {
                              setEmojiBoard(false);
                              ReactEditor.focus(editor);
                            }}
                          />
                        }
                      >
                        {(anchorRef) => (
                          <IconButton
                            ref={anchorRef}
                            aria-pressed={emojiBoard}
                            onClick={() => setEmojiBoard(true)}
                            variant="SurfaceVariant"
                            size="300"
                            radii="300"
                          >
                            <Icon size="400" src={Icons.Smile} filled={emojiBoard} />
                          </IconButton>
                        )}
                      </PopOut>
                    )}
                  </UseStateProvider>
                </Box>
              </Box>
              {toolbar && (
                <div>
                  <Line variant="SurfaceVariant" size="300" />
                  <Toolbar />
                </div>
              )}
            </>
          }
        />
      </div>
    );
  }
);
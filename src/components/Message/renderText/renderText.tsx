import React, { ComponentType } from 'react';
import ReactMarkdown, { Options, uriTransformer } from 'react-markdown';
import { find } from 'linkifyjs';
import uniqBy from 'lodash.uniqby';
import remarkGfm from 'remark-gfm';

import { Emoji } from './Emoji';
import { Anchor } from './Anchor';
import { Mention, MentionProps } from './Mention';
import { detectHttp, escapeRegExp, matchMarkdownLinks, messageCodeBlocks } from './regex';
import { emojiMarkdownPlugin, mentionsMarkdownPlugin } from './rehypePlugins';

import type { ReactMarkdownProps } from 'react-markdown/lib/complex-types';
import type { PluggableList } from 'react-markdown/lib/react-markdown';
import type { UserResponse } from 'stream-chat';
import type { DefaultStreamChatGenerics } from '../../../types/types';

export type RenderTextPluginConfigurator = (defaultPlugins: PluggableList) => PluggableList;

export const defaultAllowedTagNames: Array<keyof JSX.IntrinsicElements | 'emoji' | 'mention'> = [
  'html',
  'text',
  'br',
  'p',
  'em',
  'strong',
  'a',
  'ol',
  'ul',
  'li',
  'code',
  'pre',
  'blockquote',
  'del',
  // custom types (tagNames)
  'emoji',
  'mention',
];

function formatUrlForDisplay(url: string) {
  try {
    return decodeURIComponent(url).replace(detectHttp, '');
  } catch (e) {
    return url;
  }
}

function encodeDecode(url: string) {
  try {
    return encodeURI(decodeURIComponent(url));
  } catch (error) {
    return url;
  }
}

const transformLinkUri = (uri: string) => (uri.startsWith('app://') ? uri : uriTransformer(uri));

const getPluginsForward: RenderTextPluginConfigurator = (plugins: PluggableList) => plugins;

export const markDownRenderers: RenderTextOptions['customMarkDownRenderers'] = {
  a: Anchor,
  emoji: Emoji,
  mention: Mention,
};

export type RenderTextOptions<
  StreamChatGenerics extends DefaultStreamChatGenerics = DefaultStreamChatGenerics
> = {
  // eslint-disable-next-line @typescript-eslint/ban-types
  allowedTagNames?: Array<keyof JSX.IntrinsicElements | 'emoji' | 'mention' | (string & {})>;
  customMarkDownRenderers?: Options['components'] &
    Partial<{
      emoji: ComponentType<ReactMarkdownProps>;
      mention: ComponentType<MentionProps<StreamChatGenerics>>;
    }>;
  getRehypePlugins?: RenderTextPluginConfigurator;
  getRemarkPlugins?: RenderTextPluginConfigurator;
};

export const renderText = <
  StreamChatGenerics extends DefaultStreamChatGenerics = DefaultStreamChatGenerics
>(
  text?: string,
  mentionedUsers?: UserResponse<StreamChatGenerics>[],
  {
    allowedTagNames = defaultAllowedTagNames,
    customMarkDownRenderers,
    getRehypePlugins = getPluginsForward,
    getRemarkPlugins = getPluginsForward,
  }: RenderTextOptions = {},
) => {
  // take the @ mentions and turn them into markdown?
  // translate links
  if (!text) return null;
  if (text.trim().length === 1) return <>{text}</>;

  let newText = text;
  const markdownLinks = matchMarkdownLinks(newText);
  const codeBlocks = messageCodeBlocks(newText);

  // extract all valid links/emails within text and replace it with proper markup
  uniqBy([...find(newText, 'email'), ...find(newText, 'url')], 'value').forEach(
    ({ href, type, value }) => {
      const linkIsInBlock = codeBlocks.some((block) => block?.includes(value));

      // check if message is already  markdown
      const noParsingNeeded =
        markdownLinks &&
        markdownLinks.filter((text) => {
          const strippedHref = href?.replace(detectHttp, '');
          const strippedText = text?.replace(detectHttp, '');

          if (!strippedHref || !strippedText) return false;

          return strippedHref.includes(strippedText) || strippedText.includes(strippedHref);
        });

      if (noParsingNeeded.length > 0 || linkIsInBlock) return;

      try {
        // special case for mentions:
        // it could happen that a user's name matches with an e-mail format pattern.
        // in that case, we check whether the found e-mail is actually a mention
        // by naively checking for an existence of @ sign in front of it.
        if (type === 'email' && mentionedUsers) {
          const emailMatchesWithName = mentionedUsers.some((u) => u.name === value);
          if (emailMatchesWithName) {
            newText = newText.replace(new RegExp(escapeRegExp(value), 'g'), (match, position) => {
              const isMention = newText.charAt(position - 1) === '@';
              // in case of mention, we leave the match in its original form,
              // and we let `mentionsMarkdownPlugin` to do its job
              return isMention ? match : `[${match}](${encodeDecode(href)})`;
            });

            return;
          }
        }

        const displayLink = type === 'email' ? value : formatUrlForDisplay(href);

        newText = newText.replace(
          new RegExp(escapeRegExp(value), 'g'),
          `[${displayLink}](${encodeDecode(href)})`,
        );
      } catch (e) {
        void e;
      }
    },
  );

  const remarkPlugins: PluggableList = [[remarkGfm, { singleTilde: false }]];
  const rehypePlugins = [emojiMarkdownPlugin];

  if (mentionedUsers?.length) {
    rehypePlugins.push(mentionsMarkdownPlugin(mentionedUsers));
  }

  // TODO: remove in the next major release
  if (customMarkDownRenderers?.mention) {
    const MentionComponent = customMarkDownRenderers['mention'];

    // eslint-disable-next-line react/display-name
    customMarkDownRenderers['mention'] = ({ node, ...rest }) => (
      <MentionComponent
        // @ts-ignore
        mentioned_user={node.mentionedUser}
        // @ts-ignore
        node={{ mentioned_user: node.mentionedUser, ...node }}
        {...rest}
      />
    );
  }

  const rehypeComponents = {
    ...markDownRenderers,
    ...customMarkDownRenderers,
  };

  return (
    <ReactMarkdown
      allowedElements={allowedTagNames}
      components={rehypeComponents}
      rehypePlugins={getRehypePlugins(rehypePlugins)}
      remarkPlugins={getRemarkPlugins(remarkPlugins)}
      skipHtml
      transformLinkUri={transformLinkUri}
      unwrapDisallowed
    >
      {newText}
    </ReactMarkdown>
  );
};

import type * as std from '@std'
import { unwrapRenderer } from '../core/internals'
import { makeCommentsIterator, fetchVideoCommentsContinuationToken } from './api'
import { processComment } from './processor'

// YouTube is migrating comments to a viewModel/entity format (commentEntityPayload)
// where `thread.comment.commentRenderer` is absent. Skip those for now so the
// section degrades to empty instead of throwing; see processComment.
export async function* listComments(videoId: string): AsyncGenerator<std.Comment[]> {
  const continuation = await fetchVideoCommentsContinuationToken(videoId)
  for await (const commentThreads of makeCommentsIterator(continuation)) {
    const comments = commentThreads
      .map(unwrapRenderer)
      .filter((thread) => thread.comment?.commentRenderer !== undefined)
      .map((thread) => processComment(thread.comment))
    // todo: get the replies continuation renderer so it can be used on listCommentReplies
    yield comments
  }
}

export async function* listCommentReplies(continuation: string): AsyncGenerator<std.Comment[]> {
  for await (const commentThreads of makeCommentsIterator(continuation)) {
    const comments = commentThreads
      .map(unwrapRenderer)
      .filter((thread) => thread.comment?.commentRenderer !== undefined)
      .map((thread) => processComment(thread.comment))
    yield comments
  }
}

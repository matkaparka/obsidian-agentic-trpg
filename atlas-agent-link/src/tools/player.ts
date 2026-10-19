/** The one tool that turns the player popout into the stream frame (see atlas/playerFrame.ts). */
import { bool, num, obj, str, type ToolCtx, type ToolDef } from './shared';

export function playerTools(ctx: ToolCtx): ToolDef[] {
  return [
    {
      name: 'atlas_player_frame',
      description:
        'Turn the Atlas player popout into the single 16:9 stream picture: Atlas\' map in the middle, a transparent overlay iframe on top for the character columns and bottom bar. ' +
        'Sets the popout content size (1920x1080 by default; shrinks proportionally if the screen is smaller, unless screenFit=false), hides Atlas\' own initiative rail, moves its dice toast into the map area, and re-fits the camera so the whole background fits. ' +
        'Idempotent; call it again after a scene change to re-fit the camera. enabled=false restores the DOM, styles, window size and camera exactly. This is a write tool (read-only mode / kill switch refuses it). The url must be loopback (http://127.0.0.1:<port>/…).',
      write: true,
      inputSchema: obj(
        {
          enabled: bool('true = show the frame, false = restore the window exactly'),
          url: str('overlay page URL, loopback only (default http://127.0.0.1:8099/overlay?bg=transparent)'),
          insets: obj(
            {
              left: num('map area left inset in design pixels'),
              right: num('map area right inset in design pixels'),
              top: num('map area top inset in design pixels'),
              bottom: num('map area bottom inset in design pixels'),
            },
            []
          ),
          hideAtlasInitiative: bool('hide Atlas\' own player-window initiative rail (default true)'),
          size: obj({ w: num('design width (default 1920)'), h: num('design height (default 1080)') }, []),
          screenFit: bool('shrink the popout proportionally when the screen is smaller (default true)'),
          refitCamera: bool('recompute the camera to fit the whole background (default true)'),
          reload: bool('reload the iframe even when the URL is unchanged (use after the overlay server starts)'),
        },
        ['enabled']
      ),
      handler: async (a) => {
        const result = await ctx.playerFrame.apply({
          enabled: a.enabled !== false,
          url: a.url,
          insets: a.insets,
          hideAtlasInitiative: a.hideAtlasInitiative,
          size: a.size,
          screenFit: a.screenFit,
          refitCamera: a.refitCamera,
          reload: a.reload,
        });
        return { ...result, note: result.applied ? 'Player frame is on. Capture this window; it is the stream picture.' : 'Player frame restored to plain Atlas.' };
      },
    },
  ];
}

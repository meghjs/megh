if vim.b.did_ftplugin then return end

-- Everything HTML has (matchit pairs, omnifunc, ...), then Megh on top.
vim.cmd('runtime! ftplugin/html.vim ftplugin/html_*.vim ftplugin/html/*.vim')
vim.b.did_ftplugin = 1

vim.bo.commentstring = '{{-- %s --}}'

-- `%` jumps between @if / @elseif / @else / @endif and the other block pairs.
local blocks = {
  [[@if\>:@elseif\>:@else\>:@endif\>]],
  [[@unless\>:@else\>:@endunless\>]],
  [[@isset\>:@else\>:@endisset\>]],
  [[@foreach\>:@break\>:@continue\>:@endforeach\>]],
  [[@for\>:@break\>:@continue\>:@endfor\>]],
  [[@while\>:@break\>:@continue\>:@endwhile\>]],
  [[@section\>:@show\>:@endsection\>]],
  [[@push\>:@endpush\>]],
  [[@component\>:@endcomponent\>]],
  [[@slot\>:@endslot\>]],
  [[@react\>:@endreact\>]],
  [[@auth\>:@else\>:@endauth\>]],
  [[@guest\>:@else\>:@endguest\>]],
  [[@session\>:@endsession\>]],
  [[@can\>:@else\>:@endcan\>]],
  [[@cannot\>:@else\>:@endcannot\>]],
  [[@js\>\s*\%((\)\@!:@endjs\>]],
  [[{{--:--}}]],
}
local html = vim.b.match_words
vim.b.match_words = table.concat(blocks, ',') .. (html and html ~= '' and (',' .. html) or '')

local undo = 'setlocal commentstring< | unlet! b:match_words'
vim.b.undo_ftplugin = vim.b.undo_ftplugin and (vim.b.undo_ftplugin .. ' | ' .. undo) or undo

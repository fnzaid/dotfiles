--- Block arrow keys in normal and visual mode.
vim.keymap.set({ "n", "v" }, "<Up>", "<Nop>", { silent = true })
vim.keymap.set({ "n", "v" }, "<Down>", "<Nop>", { silent = true })
vim.keymap.set({ "n", "v" }, "<Left>", "<Nop>", { silent = true })
vim.keymap.set({ "n", "v" }, "<Right>", "<Nop>", { silent = true })

local function show_asm_float()
  local ft = vim.bo.filetype
  local file = vim.fn.expand("%:p")

  -- compiler commands
  local compilers = {
    zig = "zig build-obj -O ReleaseFast -femit-asm=- " .. vim.fn.shellescape(file),
    c = "clang -O3 -masm=intel -S -fno-asynchronous-unwind-tables -fno-dwarf2-cfi-asm -o - "
      .. vim.fn.shellescape(file),
    cpp = "clang++ -O3 -masm=intel -S -fno-asynchronous-unwind-tables -fno-dwarf2-cfi-asm -o - "
      .. vim.fn.shellescape(file),
    rust = "rustc -O --emit asm -o - " .. vim.fn.shellescape(file),
  }

  local cmd = compilers[ft]
  if not cmd then
    vim.notify("No compiler configured for filetype: " .. ft, vim.log.levels.WARN)
    return
  end

  -- Save current buffer before inspecting
  vim.cmd("silent write")

  -- 2. Execute compiler and capture stdout
  local output = {}
  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    stderr_buffered = true,
    on_stdout = function(_, data)
      if data then
        for _, line in ipairs(data) do
          if
            not line:match("^%s*%.cfi_")
            and not line:match("^%s*%.loc")
            and not line:match("^%s*%.file")
            and not line:match("^%s*%.ident")
          then
            table.insert(output, line)
          end
        end
      end
    end,
    on_stderr = function(_, err)
      if err then
        for _, l in ipairs(err) do
          if l ~= "" then
            table.insert(output, "; [ERR] " .. l)
          end
        end
      end
    end,
    on_exit = function()
      if #output == 0 then
        table.insert(output, "; No assembly generated")
      end

      local w = math.floor(vim.o.columns * 0.75)
      local h = math.floor(vim.o.lines * 0.80)
      local r = math.floor((vim.o.lines - h) / 2)
      local c = math.floor((vim.o.columns - w) / 2)

      local buf = vim.api.nvim_create_buf(false, true)
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, output)
      vim.bo[buf].filetype = "asm"
      vim.bo[buf].bufhidden = "wipe"

      local win = vim.api.nvim_open_win(buf, true, {
        relative = "editor",
        width = w,
        height = h,
        row = r,
        col = c,
        border = "rounded",
        title = " Assembly Inspector (" .. ft .. " -> x86-64) ",
        title_pos = "center",
      })

      vim.keymap.set("n", "q", "<cmd>close<cr>", { buffer = buf, silent = true })
      vim.keymap.set("n", "<Esc>", "<cmd>close<cr>", { buffer = buf, silent = true })
    end,
  })
end

-- Keymap: Press <Leader>asm in normal mode
vim.keymap.set("n", "<Leader>asm", show_asm_float, { desc = "Show floating ASM" })

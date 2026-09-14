return {
  {
    "akinsho/flutter-tools.nvim",
    lazy = false,
    dependencies = {
      "nvim-lua/plenary.nvim",
      "stevearc/dressing.nvim",
    },
    config = function()
      require("flutter-tools").setup({
        widget_guides = { enabled = true },
        closing_tags = { enabled = true, prefix = "// ", highlight = "Comment" },
        dev_log = { enabled = true, open_cmd = "tabedit" },
        dev_tools = {
          autostart = true,
          auto_open_browser = true,
        },
        lsp = {
          color = nil,
        },
        decorations = {
          statusline = { app_version = true, device = true },
        },
      })
    end,
    },
}

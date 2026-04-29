resource "fly_volume" "tabpurge_data" {
  name    = "tabpurge_data"
  size    = 1  # 1GB free tier
  region  = "fra"
  app     = "tabpurge-analytics"
}